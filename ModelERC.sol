// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

/*
 *  WEBSITE  : N/A
 *  TELEGRAM : N/A
 *  X        : N/A
 */

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IUniswapV2Factory {
    function createPair(
        address tokenA,
        address tokenB
    ) external returns (address pair);
}

interface IUniswapV2Router02 {
    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external;

    function factory() external pure returns (address);

    function getAmountsOut(
        uint256 amountIn,
        address[] calldata path
    ) external view returns (uint256[] memory amounts);

    function WETH() external pure returns (address);

    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    )
        external
        payable
        returns (uint256 amountToken, uint256 amountETH, uint256 liquidity);
}

interface IUniswapV2Pair {
    function token0() external view returns (address);

    function token1() external view returns (address);

    function getReserves()
        external
        view
        returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
}

contract ModelERC20 is ERC20, Ownable {
    struct Config {
        bool tradeEnabled;
        bool swapping;
        uint8 gasRestrictionsDurationBlocks;
        uint16 buyFees;
        uint16 sellFees;
        uint16 swapThresholdBasisPoints;
        uint16 maxTokenAmountPertransactionBasisPoints;
        uint16 maxTokenAmountPerWalletBasisPoints;
        uint16 maxPriorityFeePerGasGwei;
        uint32 deployedBlockNumber;
        uint104 placeholder;
    }

    bytes32 public constant ID =
        0x57a111374081e80da9971fbab0320cecc928b9bb1ed50257708c06a2742b8e51;

    IUniswapV2Router02 public immutable uniswapV2Router;
    address public immutable uniswapV2Pair;

    uint256 public constant PERCENT_BASE = 10000;
    uint256 public constant MAX_FEE = 2500;

    Config public config;

    constructor(
        string memory _name,
        string memory _symbol,
        uint256 _totalSupply,
        uint256 _supplyToLiquidity,
        address _routerAddress,
        uint16 _buyFees,
        uint16 _sellFees,
        uint16 _maxPriorityFeePerGas,
        uint8 _gasRestrictionsBlocks,
        bool _renounce,
        bool _tradeEnabled
    ) ERC20(_name, _symbol) Ownable(msg.sender) {
        if (_renounce) {
            config.tradeEnabled = true;
            renounceOwnership();
        } else {
            transferOwnership(tx.origin);
        }

        _mint(tx.origin, _totalSupply - _supplyToLiquidity);

        if (_supplyToLiquidity > 0) {
            _mint(msg.sender, _supplyToLiquidity);
        }

        uniswapV2Router = IUniswapV2Router02(_routerAddress);
        uniswapV2Pair = IUniswapV2Factory(uniswapV2Router.factory()).createPair(
            address(this),
            uniswapV2Router.WETH()
        );

        _approve(address(this), address(uniswapV2Router), type(uint256).max);

        if (!_renounce) {
            if (_buyFees > MAX_FEE || _sellFees > MAX_FEE) {
                revert feesTooHigh(
                    _sellFees > _buyFees ? _sellFees : _buyFees,
                    MAX_FEE
                );
            }

            config.buyFees = _buyFees;
            config.sellFees = _sellFees;

            config.tradeEnabled = _tradeEnabled;
            config.swapThresholdBasisPoints = 10;
            config.maxTokenAmountPertransactionBasisPoints = 200;
            config.maxTokenAmountPerWalletBasisPoints = 200;
        }

        config.deployedBlockNumber = uint32(block.number);
        config.maxPriorityFeePerGasGwei = _maxPriorityFeePerGas;
        config.gasRestrictionsDurationBlocks = _gasRestrictionsBlocks;
    }

    function setFees(uint16 _buyFees, uint16 _sellFees) external onlyOwner {
        if (_buyFees > MAX_FEE || _sellFees > MAX_FEE) {
            revert feesTooHigh(
                _sellFees > _buyFees ? _sellFees : _buyFees,
                MAX_FEE
            );
        }
        config.buyFees = _buyFees;
        config.sellFees = _sellFees;
    }

    function setSwapThreshold(uint16 _supplyPercent) external onlyOwner {
        if (_supplyPercent < 1 || _supplyPercent > 100) {
            revert swapThresholdOutOfRange(_supplyPercent, 1, 100);
        }
        config.swapThresholdBasisPoints = _supplyPercent;
    }

    function setMaxSupplyPercentPertransaction(
        uint16 _newSupplyPercentBasisPoints
    ) external onlyOwner {
        if (_newSupplyPercentBasisPoints < 10) {
            revert belowMinSupplyPercentPertransaction(
                _newSupplyPercentBasisPoints,
                10
            );
        }
        config
            .maxTokenAmountPertransactionBasisPoints = _newSupplyPercentBasisPoints >=
            PERCENT_BASE
            ? 0
            : _newSupplyPercentBasisPoints;
    }

    function setMaxSupplyPercentPerWallet(
        uint16 _newSupplyPercentBasisPoints
    ) external onlyOwner {
        if (_newSupplyPercentBasisPoints < 50) {
            revert belowMinSupplyPercentPerWallet(
                _newSupplyPercentBasisPoints,
                50
            );
        }
        config
            .maxTokenAmountPerWalletBasisPoints = _newSupplyPercentBasisPoints >=
            PERCENT_BASE
            ? 0
            : _newSupplyPercentBasisPoints;
    }

    function enableTrade() external onlyOwner {
        config.tradeEnabled = true;
    }

    function _update(
        address from,
        address to,
        uint256 amount
    ) internal override {
        _checkGasPriceBounds();

        if (_isUnbounded(from, to) || owner() == address(0)) {
            super._update(from, to, amount);
            return;
        }

        if (!config.tradeEnabled) revert tradeNotEnabled();

        bool buying = from == uniswapV2Pair && to != address(uniswapV2Router);
        bool selling = from != address(uniswapV2Router) && to == uniswapV2Pair;

        if (
            (!buying && !selling) ||
            (buying && config.buyFees == 0) ||
            (selling && config.sellFees == 0)
        ) {
            _checkTransferAmounts(to, amount);
            super._update(from, to, amount);
            return;
        }

        if (
            msg.sender != uniswapV2Pair &&
            balanceOf(address(this)) >=
            _getAmountFromBasisPoints(
                totalSupply(),
                config.swapThresholdBasisPoints
            )
        ) _swapBalanceToETH();

        uint16 fees = buying ? config.buyFees : selling ? config.sellFees : 0;

        uint256 totalFees = _getAmountFromBasisPoints(amount, fees);

        uint256 amountAfterFees = amount - totalFees;
        _checkTransferAmounts(to, amountAfterFees);

        if (totalFees > 0) super._update(from, address(this), totalFees);
        super._update(from, to, amountAfterFees);
    }

    function _checkGasPriceBounds() internal view {
        if (
            block.number - config.deployedBlockNumber >=
            config.gasRestrictionsDurationBlocks
        ) return;

        if (
            tx.gasprice - block.basefee >
            config.maxPriorityFeePerGasGwei * 1 gwei
        ) {
            revert restricted(msg.sender);
        }
    }

    function _getAmountFromBasisPoints(
        uint256 amount,
        uint16 basisPoints
    ) internal pure returns (uint256) {
        return (amount * basisPoints) / PERCENT_BASE;
    }

    function _checkTransferAmounts(address to, uint256 amount) internal view {
        if (config.maxTokenAmountPertransactionBasisPoints != 0) {
            if (
                amount >
                _getAmountFromBasisPoints(
                    totalSupply(),
                    config.maxTokenAmountPertransactionBasisPoints
                )
            ) {
                revert aboveMaxSupplyPercentPertransaction(
                    amount,
                    _getAmountFromBasisPoints(
                        totalSupply(),
                        config.maxTokenAmountPertransactionBasisPoints
                    )
                );
            }
        }

        if (to == uniswapV2Pair) return;

        if (config.maxTokenAmountPerWalletBasisPoints == 0) return;

        if (
            balanceOf(to) + amount >
            _getAmountFromBasisPoints(
                totalSupply(),
                config.maxTokenAmountPerWalletBasisPoints
            )
        ) {
            revert aboveMaxSupplyPercentPerWallet(
                amount,
                _getAmountFromBasisPoints(
                    totalSupply(),
                    config.maxTokenAmountPerWalletBasisPoints
                )
            );
        }
    }

    function _isUnbounded(
        address from,
        address to
    ) internal view returns (bool) {
        return
            tx.origin == owner() ||
            from == owner() ||
            to == owner() ||
            to == address(this) ||
            config.swapping;
    }

    function _swapBalanceToETH() private {
        config.swapping = true;
        uint256 amountIn = balanceOf(address(this));

        _approve(address(this), address(uniswapV2Router), amountIn);
        address[] memory path = new address[](2);
        path[0] = address(this);
        path[1] = uniswapV2Router.WETH();

        uniswapV2Router.swapExactTokensForETHSupportingFeeOnTransferTokens(
            amountIn,
            0,
            path,
            owner(),
            block.timestamp
        );

        config.swapping = false;
    }

    function renounceOwnership() public override onlyOwner {
        if (balanceOf(address(this)) > 0) _swapBalanceToETH();
        super.renounceOwnership();
    }

    function withdrawToken(address token) external onlyOwner {
        uint256 balance = IERC20(token).balanceOf(address(this));
        IERC20(token).transfer(msg.sender, balance);
    }

    error aboveMaxSupplyPercentPertransaction(
        uint256 amount,
        uint256 maxAmount
    );
    error aboveMaxSupplyPercentPerWallet(uint256 amount, uint256 maxAmount);
    error belowMinSupplyPercentPertransaction(
        uint256 amount,
        uint256 minAmount
    );
    error belowMinSupplyPercentPerWallet(uint256 amount, uint256 minAmount);
    error tradeNotEnabled();
    error restricted(address account);
    error swapThresholdOutOfRange(
        uint256 threshold,
        uint256 minThreshold,
        uint256 maxThreshold
    );
    error feesTooHigh(uint256 fees, uint256 maxFees);
}
