import { Contract } from '@ethersproject/contracts'
import { getAddress } from '@ethersproject/address'
import { AddressZero } from '@ethersproject/constants'
import { JsonRpcSigner, JsonRpcProvider, TransactionResponse, TransactionReceipt } from '@ethersproject/providers'
import { BigNumber } from '@ethersproject/bignumber'
import IPangolinRouter from '@pangolindex/exchange-contracts/artifacts/contracts/pangolin-periphery/interfaces/IPangolinRouter.sol/IPangolinRouter.json'
import { MIN_ETH, ROUTER_ADDRESS } from '../constants'
import { ChainId, JSBI, CurrencyAmount, CHAINS, TokenAmount, Currency, Token, CAVAX, Chain } from '@pangolindex/sdk'
import { parseUnits } from 'ethers/lib/utils'
import { wait } from './retry'

// returns the checksummed address if the address is valid, otherwise returns false
export function isAddress(value: any): string | false {
  try {
    return getAddress(value)
  } catch {
    return false
  }
}

export function isEvmChain(chainId: ChainId = 43114): boolean {
  if (CHAINS[chainId]?.evm) {
    return true
  }
  return false
}

// add 10%
export function calculateGasMargin(value: BigNumber): BigNumber {
  return value.mul(BigNumber.from(10000).add(BigNumber.from(1000))).div(BigNumber.from(10000))
}

export function calculateSlippageAmount(value: CurrencyAmount, slippage: number): [JSBI, JSBI] {
  if (slippage < 0 || slippage > 10000) {
    throw Error(`Unexpected slippage value: ${slippage}`)
  }
  return [
    JSBI.divide(JSBI.multiply(value.raw, JSBI.BigInt(10000 - slippage)), JSBI.BigInt(10000)),
    JSBI.divide(JSBI.multiply(value.raw, JSBI.BigInt(10000 + slippage)), JSBI.BigInt(10000))
  ]
}

// account is not optional
export function getSigner(library: JsonRpcProvider, account: string): JsonRpcSigner {
  return library.getSigner(account).connectUnchecked()
}

// account is optional
export function getProviderOrSigner(library: JsonRpcProvider, account?: string): JsonRpcProvider | JsonRpcSigner {
  return account ? getSigner(library, account) : library
}

// account is optional
export function getContract(address: string, ABI: any, library: JsonRpcProvider, account?: string): Contract {
  if (!isAddress(address) || address === AddressZero) {
    throw Error(`Invalid 'address' parameter '${address}'.`)
  }

  return new Contract(address, ABI, getProviderOrSigner(library, account))
}

// account is optional
export function getRouterContract(chainId: ChainId, library: JsonRpcProvider, account?: string): Contract {
  return getContract(ROUTER_ADDRESS[chainId], IPangolinRouter.abi, library, account)
}

// try to parse a user entered amount for a given token
export function tryParseAmount(chainId: ChainId, value?: string, currency?: Currency): CurrencyAmount | undefined {
  if (!value || !currency) {
    return undefined
  }
  try {
    const typedValueParsed = parseUnits(value, currency.decimals).toString()
    if (typedValueParsed !== '0') {
      return currency instanceof Token
        ? new TokenAmount(currency, JSBI.BigInt(typedValueParsed))
        : CurrencyAmount.ether(JSBI.BigInt(typedValueParsed), chainId)
    }
  } catch (error) {
    // should fail if the user specifies too many decimal places of precision (or maybe exceed max uint?)
    console.debug(`Failed to parse input amount: "${value}"`, error)
  }
  // necessary for all paths to return a value
  return undefined
}

/**
 * Given some token amount, return the max that can be spent of it
 * @param currencyAmount to return max of
 */
export function maxAmountSpend(chainId: ChainId, currencyAmount?: CurrencyAmount): CurrencyAmount | undefined {
  if (!currencyAmount) return undefined
  if (chainId && currencyAmount.currency === CAVAX[chainId]) {
    if (JSBI.greaterThan(currencyAmount.raw, MIN_ETH)) {
      return CurrencyAmount.ether(JSBI.subtract(currencyAmount.raw, MIN_ETH), chainId)
    } else {
      return CurrencyAmount.ether(JSBI.BigInt(0), chainId)
    }
  }
  return currencyAmount
}

export async function waitForTransaction(
  provider: any,
  tx: TransactionResponse,
  confirmations?: number,
  timeout = 7000 // 7 seconds
) {
  const result = await Promise.race([
    tx.wait(confirmations),
    (async () => {
      await wait(timeout)
      const mempoolTx: TransactionReceipt | undefined = await provider.getTransactionReceipt(tx.hash)
      return mempoolTx
    })()
  ])
  return result
}

export async function switchNetwork(chain: Chain) {
  const { ethereum } = window

  if (ethereum && chain?.evm) {
    try {
      await ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${chain?.chain_id?.toString(16)}` }]
      })
    } catch (error) {
      const err = error as any
      if (err.code === 4902) {
        await ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainName: chain.name,
              chainId: `0x${chain?.chain_id?.toString(16)}`,
              rpcUrls: [chain.rpc_uri],
              blockExplorerUrls: chain.blockExplorerUrls,
              iconUrls: chain.logo,
              nativeCurrency: chain.nativeCurrency
            }
          ]
        })
      }
    }
  }
}
