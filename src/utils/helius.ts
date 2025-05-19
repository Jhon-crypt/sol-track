import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

// Base interface for token data
interface BaseToken {
  address: string;
  name: string;
  symbol: string;
  mintDate?: Date;  // Changed from createdAt to mintDate
  isNewToken?: boolean;
}

// Jupiter API response interface
interface JupiterToken extends BaseToken {
  address: string;
  symbol: string;
  name: string;
}

// Interface for tokens found through on-chain data
interface OnChainToken extends BaseToken {
  source: 'on-chain';
  isNewToken: boolean;
}

// Main token info interface used throughout the app
export interface TokenInfo extends BaseToken {
  source: string;  // 'jupiter' | 'on-chain'
  isNewToken: boolean;
}

// RPC endpoint for direct Solana connection
const connection = new Connection('https://api.mainnet-beta.solana.com');

export async function searchTokens(query: string): Promise<TokenInfo[]> {
  try {
    const results = new Map<string, TokenInfo>();
    const searchQuery = query.toLowerCase();
    const currentTime = new Date();
    const ONE_DAY = 24 * 60 * 60 * 1000;

    // Check if the query looks like a contract address
    const isAddressSearch = searchQuery.length >= 32;  // Solana addresses are 32-44 chars
    
    if (isAddressSearch) {
      try {
        const tokenDetails = await getTokenDetails(query);
        if (tokenDetails) {
          results.set(tokenDetails.address, tokenDetails);
          return Array.from(results.values());
        }
      } catch (error) {
        console.error('Error searching by address:', error);
      }
    }

    // 1. Search Jupiter's token list
    try {
      const jupiterResponse = await fetch('https://token.jup.ag/all');
      const jupiterTokens: JupiterToken[] = await jupiterResponse.json();
      
      const matchingTokens = jupiterTokens.filter((token) => 
        token.symbol.toLowerCase().includes(searchQuery) || 
        token.name.toLowerCase().includes(searchQuery) ||
        token.address.toLowerCase().includes(searchQuery)
      );

      await Promise.all(
        matchingTokens.map(async (token) => {
          try {
            // Get all signatures and sort by timestamp to find the mint transaction
            const signatures = await connection.getSignaturesForAddress(
              new PublicKey(token.address),
              { limit: 10 } // Fetch more signatures to ensure we find the mint tx
            );

            if (signatures.length > 0) {
              // Sort signatures by block time to get the earliest one (mint transaction)
              const sortedSigs = signatures.sort((a, b) => 
                (a.blockTime || 0) - (b.blockTime || 0)
              );
              
              const mintTx = await connection.getTransaction(sortedSigs[0].signature);
              const mintDate = mintTx?.blockTime ? new Date(mintTx.blockTime * 1000) : undefined;
              const isNewToken = mintDate ? (currentTime.getTime() - mintDate.getTime() <= ONE_DAY) : false;

              results.set(token.address, {
                address: token.address,
                name: token.name,
                symbol: token.symbol,
                source: 'jupiter',
                mintDate,
                isNewToken
              });
            } else {
              results.set(token.address, {
                address: token.address,
                name: token.name,
                symbol: token.symbol,
                source: 'jupiter',
                isNewToken: false
              });
            }
          } catch (error) {
            console.error('Error fetching token mint date:', error);
            results.set(token.address, {
              address: token.address,
              name: token.name,
              symbol: token.symbol,
              source: 'jupiter',
              isNewToken: false
            });
          }
        })
      );
    } catch (error) {
      console.error('Error fetching from Jupiter:', error);
    }

    // 2. Search recent token mints
    try {
      const recentSignatures = await connection.getSignaturesForAddress(
        new PublicKey(TOKEN_PROGRAM_ID),
        { limit: 100 }
      );

      const mintAddresses = await Promise.all(
        recentSignatures.map(async (sig) => {
          try {
            const tx = await connection.getTransaction(sig.signature);
            if (!tx?.meta?.postTokenBalances?.length) return null;
            
            const mintAddress = tx.meta.postTokenBalances[0].mint;
            const mintDate = tx.blockTime ? new Date(tx.blockTime * 1000) : undefined;
            const isNewToken = mintDate ? (currentTime.getTime() - mintDate.getTime() <= ONE_DAY) : true;
            
            const tokenInfo = await connection.getParsedAccountInfo(new PublicKey(mintAddress));
            
            if (!tokenInfo.value?.data || typeof tokenInfo.value.data !== 'object') return null;
            
            const data = tokenInfo.value.data;
            if ('parsed' in data && data.parsed.type === 'mint') {
              const tokenData = data.parsed.info;
              const mint: OnChainToken = {
                address: mintAddress,
                name: tokenData.name || 'Unknown',
                symbol: tokenData.symbol || 'Unknown',
                source: 'on-chain',
                mintDate,
                isNewToken
              };
              return mint;
            }
            return null;
          } catch (error) {
            console.error('Error processing transaction:', error);
            return null;
          }
        })
      );

      mintAddresses
        .filter((mint): mint is OnChainToken => 
          mint !== null && 
          (mint.symbol.toLowerCase().includes(searchQuery) || 
           mint.name.toLowerCase().includes(searchQuery))
        )
        .forEach(mint => {
          if (!results.has(mint.address)) {
            results.set(mint.address, mint);
          }
        });
    } catch (error) {
      console.error('Error searching recent mints:', error);
    }

    // Sort by mint date
    const allTokens = Array.from(results.values());
    const sortedTokens = allTokens.sort((a, b) => {
      if (!a.mintDate && !b.mintDate) return 0;
      if (!a.mintDate) return 1;
      if (!b.mintDate) return -1;
      return b.mintDate.getTime() - a.mintDate.getTime();
    });

    const newTokens = sortedTokens.filter(token => token.isNewToken);
    const oldTokens = sortedTokens.filter(token => !token.isNewToken);
    
    return [...newTokens, ...oldTokens].slice(0, 50);

  } catch (error) {
    console.error('Error searching tokens:', error);
    throw error;
  }
}

export async function getTokenDetails(address: string): Promise<TokenInfo | null> {
  try {
    // First check Jupiter's list
    const jupiterResponse = await fetch('https://token.jup.ag/all');
    const tokens: JupiterToken[] = await jupiterResponse.json();
    const jupiterToken = tokens.find(t => t.address === address);
    
    let mintDate: Date | undefined;
    
    // Get creation date from on-chain data
    try {
      const signatures = await connection.getSignaturesForAddress(
        new PublicKey(address),
        { limit: 1 }
      );

      if (signatures.length > 0) {
        const tx = await connection.getTransaction(signatures[signatures.length - 1].signature);
        mintDate = tx?.blockTime ? new Date(tx.blockTime * 1000) : undefined;
      }
    } catch (error) {
      console.error('Error fetching token creation date:', error);
    }
    
    if (jupiterToken) {
      return {
        address: jupiterToken.address,
        name: jupiterToken.name,
        symbol: jupiterToken.symbol,
        source: 'jupiter',
        mintDate,
        isNewToken: false
      };
    }

    // If not found in Jupiter, try getting on-chain data
    try {
      const tokenInfo = await connection.getParsedAccountInfo(new PublicKey(address));
      if (!tokenInfo.value?.data || typeof tokenInfo.value.data !== 'object') return null;
      
      const data = tokenInfo.value.data;
      if ('parsed' in data && data.parsed.type === 'mint') {
        const tokenData = data.parsed.info;
        const onChainToken: OnChainToken = {
          address: address,
          name: tokenData.name || 'Unknown',
          symbol: tokenData.symbol || 'Unknown',
          source: 'on-chain',
          mintDate,
          isNewToken: false
        };
        return onChainToken;
      }
    } catch (error) {
      console.error('Error getting on-chain token details:', error);
    }

    return null;
  } catch (error) {
    console.error('Error getting token details:', error);
    throw error;
  }
} 