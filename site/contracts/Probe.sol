// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// Hoodwink probe. Never deployed: the scanner injects this runtime code at a throwaway address
/// through an eth_call state override, funds it the same way, and asks it to buy, move and sell a token.
/// Nothing is broadcast. Every step is wrapped so a revert is reported as a stage, not as a failed call.

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
}

interface ICurve {
    function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) external payable returns (uint256);
    function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient) external returns (uint256);
}

struct PoolKey { address c0; address c1; uint24 fee; int24 tickSpacing; address hooks; }
struct SwapParams { bool zeroForOne; int256 amountSpecified; uint160 sqrtPriceLimitX96; }

interface IPoolManager {
    function unlock(bytes calldata data) external returns (bytes memory);
    function swap(PoolKey memory key, SwapParams memory params, bytes calldata hookData) external returns (int256);
    function sync(address currency) external;
    function settle() external payable returns (uint256);
    function take(address currency, address to, uint256 amount) external;
}

contract Probe {
    address constant PM = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant FRESH = 0x000000000000000000000000000000000000bEEF;
    uint160 constant MIN_SQRT = 4295128740;
    uint160 constant MAX_SQRT = 1461446703485210103287273603730426869456052678;

    struct Result {
        uint8 stage;        // 0 nothing ran, 1 buy failed, 2 transfer failed, 3 sell failed, 4 complete
        uint256 quoteIn;    // quote spent on the buy
        uint256 quoted;     // tokens the venue said it sent
        uint256 received;   // tokens that actually arrived (balance delta)
        uint256 sent;       // tokens sent wallet to wallet
        uint256 arrived;    // tokens the fresh wallet actually received
        uint256 sold;       // tokens offered on the sell
        uint256 quoteBack;  // quote that came back
        bytes revertData;   // revert data of the failing stage
    }

    receive() external payable {}

    function _bal(address t, address who) internal view returns (uint256) {
        return t == address(0) ? who.balance : IERC20(t).balanceOf(who);
    }

    /// wallet to wallet move of a share of what we hold, then report what arrived
    function _move(address token, Result memory r) internal returns (bool) {
        uint256 have = IERC20(token).balanceOf(address(this));
        r.sent = have / 4;
        if (r.sent == 0) return true;
        uint256 before = IERC20(token).balanceOf(FRESH);
        try IERC20(token).transfer(FRESH, r.sent) returns (bool ok) {
            if (!ok) { r.stage = 2; return false; }
        } catch (bytes memory e) { r.stage = 2; r.revertData = e; return false; }
        r.arrived = IERC20(token).balanceOf(FRESH) - before;
        return true;
    }

    // ---------------------------------------------------------------- Pons bonding curve
    function curveRoundTrip(address curve, address token, address pair, uint256 quoteIn) external returns (Result memory r) {
        r.quoteIn = quoteIn;
        if (pair != address(0)) IERC20(pair).approve(curve, type(uint256).max);
        uint256 t0 = IERC20(token).balanceOf(address(this));
        try ICurve(curve).buy{value: pair == address(0) ? quoteIn : 0}(quoteIn, 0, address(this)) returns (uint256 out) {
            r.quoted = out;
        } catch (bytes memory e) { r.stage = 1; r.revertData = e; return r; }
        r.received = IERC20(token).balanceOf(address(this)) - t0;
        if (!_move(token, r)) return r;
        r.sold = IERC20(token).balanceOf(address(this));
        IERC20(token).approve(curve, type(uint256).max);
        uint256 q0 = _bal(pair, address(this));
        try ICurve(curve).sell(r.sold, 0, address(this)) returns (uint256) {}
        catch (bytes memory e) { r.stage = 3; r.revertData = e; return r; }
        r.quoteBack = _bal(pair, address(this)) - q0;
        r.stage = 4;
    }

    // ---------------------------------------------------------------- Uniswap v4 pool (graduated Pons coins)
    function v4RoundTrip(PoolKey calldata key, address token, uint256 quoteIn) external returns (Result memory r) {
        r.quoteIn = quoteIn;
        address quote = key.c0 == token ? key.c1 : key.c0;
        uint256 t0 = IERC20(token).balanceOf(address(this));
        try IPoolManager(PM).unlock(abi.encode(key, quote, quoteIn)) returns (bytes memory out) {
            r.quoted = abi.decode(out, (uint256));
        } catch (bytes memory e) { r.stage = 1; r.revertData = e; return r; }
        r.received = IERC20(token).balanceOf(address(this)) - t0;
        if (!_move(token, r)) return r;
        r.sold = IERC20(token).balanceOf(address(this));
        uint256 q0 = _bal(quote, address(this));
        try IPoolManager(PM).unlock(abi.encode(key, token, r.sold)) returns (bytes memory) {}
        catch (bytes memory e) { r.stage = 3; r.revertData = e; return r; }
        r.quoteBack = _bal(quote, address(this)) - q0;
        r.stage = 4;
    }

    /// exact-input swap of `amount` of `currencyIn` through `key`; returns the amount taken out
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == PM, "pm");
        (PoolKey memory key, address cin, uint256 amount) = abi.decode(data, (PoolKey, address, uint256));
        bool zeroForOne = cin == key.c0;
        int256 delta = IPoolManager(PM).swap(
            key,
            SwapParams(zeroForOne, -int256(amount), zeroForOne ? MIN_SQRT : MAX_SQRT),
            ""
        );
        int128 a0 = int128(delta >> 128);
        int128 a1 = int128(delta);
        int128 owed = zeroForOne ? a0 : a1;
        int128 gets = zeroForOne ? a1 : a0;
        address cout = zeroForOne ? key.c1 : key.c0;
        uint256 pay = uint256(uint128(-owed));
        if (cin == address(0)) {
            IPoolManager(PM).settle{value: pay}();
        } else {
            IPoolManager(PM).sync(cin);
            IERC20(cin).transfer(PM, pay);
            IPoolManager(PM).settle();
        }
        uint256 out = uint256(uint128(gets));
        IPoolManager(PM).take(cout, address(this), out);
        return abi.encode(out);
    }

    // ---------------------------------------------------------------- generic: run as a real holder
    /// The scanner puts this code at an address that already holds the token (an EOA, so nothing is lost)
    /// and asks it to move a share of its balance to a fresh address.
    function holderMove(address token) external returns (Result memory r) {
        r.received = IERC20(token).balanceOf(address(this));
        if (!_move(token, r)) return r;
        r.stage = 4;
    }

    // ---------------------------------------------------------------- batch reads
    /// code size of many addresses in one call (tells contracts from wallets)
    function codeSizes(address[] calldata a) external view returns (uint256[] memory s, bytes32[] memory h) {
        s = new uint256[](a.length);
        h = new bytes32[](a.length);
        for (uint256 i; i < a.length; i++) { s[i] = a[i].code.length; h[i] = a[i].codehash; }
    }
}
