import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

// Define the asset interface to fix the 'any' type issues
interface AssetContent {
  metadata?: {
    name?: string;
    symbol?: string;
    description?: string;
  };
}

interface Asset {
  id: string;
  content?: AssetContent;
  authorities?: Array<{ address: string }>;
  createdAt?: string;
}

export interface TokenMetadata {
  name?: string;
  symbol?: string;
  description?: string;
  image?: string;
  attributes?: Array<{
    trait_type: string;
    value: string;
  }>;
  properties?: Record<string, unknown>;
}

interface TokenResult {
  id: string;
  content?: {
    metadata?: {
      name?: string;
      symbol?: string;
    };
  };
  mint?: string;
  ownership?: {
    owner?: string;
  };
}

interface JupiterToken {
  address: string;
  symbol: string;
  name: string;
}

export interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  source: string;  // Make source required
}

interface OnChainMint {
  address: string;
  name: string;
  symbol: string;
  source: 'on-chain';
}

// RPC endpoint for direct Solana connection
const connection = new Connection('https://api.mainnet-beta.solana.com');

export async function searchTokens(query: string): Promise<TokenInfo[]> {
  try {
    const results = new Map<string, TokenInfo>();
    const searchQuery = query.toLowerCase();

    // 1. Search Jupiter's token list (fastest source)
    try {
      const jupiterResponse = await fetch('https://token.jup.ag/all');
      const jupiterTokens: JupiterToken[] = await jupiterResponse.json();
      
      jupiterTokens
        .filter((token) => 
          token.symbol.toLowerCase().includes(searchQuery) || 
          token.name.toLowerCase().includes(searchQuery)
        )
        .forEach(token => {
          results.set(token.address, {
            address: token.address,
            name: token.name,
            symbol: token.symbol,
            source: 'jupiter'
          });
        });
    } catch (error) {
      console.error('Error fetching from Jupiter:', error);
    }

    // 2. Search recent token mints (for new tokens)
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
            
            // Get the mint address from the transaction
            const mintAddress = tx.meta.postTokenBalances[0].mint;
            const tokenInfo = await connection.getParsedAccountInfo(new PublicKey(mintAddress));
            
            if (!tokenInfo.value?.data || typeof tokenInfo.value.data !== 'object') return null;
            
            const data = tokenInfo.value.data;
            if ('parsed' in data && data.parsed.type === 'mint') {
              const tokenData = data.parsed.info;
              const mint: OnChainMint = {
                address: mintAddress,
                name: tokenData.name || 'Unknown',
                symbol: tokenData.symbol || 'Unknown',
                source: 'on-chain'
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

      // Add valid mint addresses to results
      mintAddresses
        .filter((mint): mint is OnChainMint => 
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

    // Convert results map to array and limit to top 50 matches
    return Array.from(results.values()).slice(0, 50);

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
    
    if (jupiterToken) {
      return {
        address: jupiterToken.address,
        name: jupiterToken.name,
        symbol: jupiterToken.symbol,
        source: 'jupiter'
      };
    }

    // If not found in Jupiter, try getting on-chain data
    try {
      const tokenInfo = await connection.getParsedAccountInfo(new PublicKey(address));
      if (!tokenInfo.value?.data || typeof tokenInfo.value.data !== 'object') return null;
      
      const data = tokenInfo.value.data;
      if ('parsed' in data && data.parsed.type === 'mint') {
        const tokenData = data.parsed.info;
        const onChainToken: OnChainMint = {
          address: address,
          name: tokenData.name || 'Unknown',
          symbol: tokenData.symbol || 'Unknown',
          source: 'on-chain'
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