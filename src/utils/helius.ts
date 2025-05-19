import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

// Metadata program ID
const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

// Base interface for token data
interface BaseToken {
  address: string;
  name: string;
  symbol: string;
  mintDate?: Date;
  isNewToken?: boolean;
  supply?: string;
  holders?: number;
  metadata?: {
    name: string;
    symbol: string;
    uri?: string;
  };
}

// Main token info interface used throughout the app
export interface TokenInfo extends BaseToken {
  source: string;
  isNewToken: boolean;
}

// Known token addresses - helps with initial search but doesn't limit results
const KNOWN_TOKENS: Record<string, { address: string; symbol: string; name: string }> = {
  'BONK': {
    address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    symbol: 'BONK',
    name: 'Bonk'
  }
};

// Use Helius RPC endpoint for better performance
const HELIUS_API_KEY = process.env.NEXT_PUBLIC_HELIUS_API_KEY;
if (!HELIUS_API_KEY) {
  throw new Error('NEXT_PUBLIC_HELIUS_API_KEY is not set in environment variables');
}

const connection = new Connection(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`, {
  commitment: 'confirmed',
});

// Cache for recent transactions to avoid re-fetching
interface CachedTransaction {
  meta?: {
    postTokenBalances?: Array<{
      mint: string;
    }>;
  };
  blockTime?: number | null;
}

const transactionCache = new Map<string, CachedTransaction>();

// Helper function to add delay between requests
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Optimized retry function with better backoff strategy
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  retries = 3,
  baseDelay = 1000, // Increased base delay
  maxDelay = 10000  // Maximum delay cap
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (i === retries) {
        throw lastError;
      }

      // Calculate delay with exponential backoff and jitter
      const exponentialDelay = Math.min(
        baseDelay * Math.pow(2, i) + Math.random() * 1000,
        maxDelay
      );
      
      // Longer delays for rate limit errors
      const delay = lastError.message.toLowerCase().includes('rate limit') 
        ? exponentialDelay * 2 
        : exponentialDelay;
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

// Enhanced token matching to find more relevant tokens
function matchesTokenQuery(query: string, name: string, symbol: string, address: string): boolean {
  query = query.toLowerCase().trim();
  name = name.toLowerCase().trim();
  symbol = symbol.toLowerCase().trim();
  address = address.toLowerCase().trim();

  // Direct matches should be prioritized
  if (symbol === query || name === query || address === query) {
    return true;
  }

  // For short queries (likely tickers), be more strict
  if (query.length <= 5) {
    return symbol.includes(query) || 
           query.includes(symbol) || 
           name.startsWith(query);
  }

  // For longer queries, check if any word matches exactly
  const queryWords = query.split(/[\s_-]+/);
  const nameWords = name.split(/[\s_-]+/);
  const symbolWords = symbol.split(/[\s_-]+/);

  // Check for exact word matches
  for (const word of queryWords) {
    if (word.length < 2) continue;
    
    if (symbolWords.includes(word) || nameWords.includes(word)) {
      return true;
    }
  }

  // Only check for partial matches if no exact matches found
  return symbol.includes(query) || 
         name.includes(query) || 
         (query.length > 10 && address.includes(query)); // Only match address for long queries
}

// Helper function to get metadata address
function findMetadataAddress(mint: PublicKey): PublicKey {
  const [publicKey] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('metadata'),
      METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    METADATA_PROGRAM_ID
  );
  return publicKey;
}

// Helper function to sanitize text
function sanitizeTokenText(text: string): string {
  // Remove non-printable characters and common garbage patterns
  const cleaned = text.replace(/[^\x20-\x7E]/g, '')  // Keep only printable ASCII
                     .replace(/[^\w\s-]/g, '')        // Remove special characters except dash
                     .trim();
  
  // Return "Unknown" if the cleaned text is too short or empty
  return cleaned.length < 2 ? 'Unknown' : cleaned;
}

// Optimized token info fetching with metadata
async function getTokenInfoFromMint(
  mintAddress: string,
  blockTime?: number | null
): Promise<TokenInfo | null> {
  try {
    const mintPubkey = new PublicKey(mintAddress);
    const [tokenInfo, metadataInfo] = await Promise.all([
      retryWithBackoff(
        () => connection.getParsedAccountInfo(mintPubkey),
        2
      ),
      retryWithBackoff(
        () => connection.getAccountInfo(findMetadataAddress(mintPubkey)),
        1
      ).catch(() => null)
    ]);

    if (!tokenInfo.value?.data || typeof tokenInfo.value.data !== 'object') return null;

    const data = tokenInfo.value.data;
    if (!('parsed' in data) || data.parsed.type !== 'mint') return null;

    const tokenData = data.parsed.info;
    const currentTime = new Date();
    const mintDate = blockTime ? new Date(blockTime * 1000) : undefined;
    const isNewToken = mintDate ? (currentTime.getTime() - mintDate.getTime() <= 24 * 60 * 60 * 1000) : false;

    // Try to decode metadata if available
    let metadata;
    if (metadataInfo?.data) {
      try {
        const nameLength = metadataInfo.data[4];
        const name = metadataInfo.data.slice(5, 5 + nameLength).toString('utf8');
        
        const symbolStart = 5 + nameLength;
        const symbolLength = metadataInfo.data[symbolStart];
        const symbol = metadataInfo.data.slice(symbolStart + 1, symbolStart + 1 + symbolLength).toString('utf8');
        
        const uriStart = symbolStart + 1 + symbolLength;
        const uriLength = metadataInfo.data[uriStart];
        const uri = metadataInfo.data.slice(uriStart + 1, uriStart + 1 + uriLength).toString('utf8');

        metadata = {
          name: sanitizeTokenText(name),
          symbol: sanitizeTokenText(symbol),
          uri
        };
      } catch {
        // Ignore metadata parsing errors
      }
    }

    // Use metadata values if available, fallback to mint data
    const tokenName = metadata?.name || sanitizeTokenText(tokenData.name || '');
    const tokenSymbol = metadata?.symbol || sanitizeTokenText(tokenData.symbol || '');

    // Skip tokens with invalid or missing names/symbols
    if (tokenName === 'Unknown' || tokenSymbol === 'Unknown') {
      return null;
    }

    return {
      address: mintAddress,
      name: tokenName,
      symbol: tokenSymbol,
      source: 'on-chain',
      mintDate,
      isNewToken,
      supply: tokenData.supply || '0',
      metadata
    };
  } catch {
    return null;
  }
}

// Interface for Helius API response
interface HeliusAsset {
  interface: string;
  id: string;
  content: {
    metadata: {
      name: string;
      symbol: string;
      description?: string;
    };
    links?: {
      image?: string;
    };
  };
  authorities?: Array<{
    address: string;
    scopes: string[];
  }>;
  compression: {
    compressed: boolean;
    data_hash: string;
    creator_hash: string;
    asset_hash: string;
    tree: string;
    seq: number;
    leaf_id: number;
  };
  grouping?: Array<{
    group_key: string;
    group_value: string;
  }>;
  royalty: {
    royalty_model: string;
    target: null | number;
    percent: number;
    basis_points: number;
    primary_sale_happened: boolean;
    locked: boolean;
  };
  supply: {
    print_max_supply: number;
    print_current_supply: number;
    edition_nonce: number;
  };
  mutable: boolean;
  burnt: boolean;
  token_info?: {
    balance?: string;
    supply?: string;
    mint?: string;
  };
  ownership: {
    frozen: boolean;
    delegated: boolean;
    delegate: null | string;
    owner: string;
    ownership_model: string;
  };
  created_at?: string;
  updated_at?: string;
}

interface HeliusResponse {
  jsonrpc: string;
  result: {
    items: HeliusAsset[];
    total: number;
    limit: number;
    page: number;
  };
  id: string;
  error?: {
    code: number;
    message: string;
  };
}

// Fast token lookup using Helius DAS API
async function searchTokensBySymbol(query: string): Promise<TokenInfo[]> {
  try {
    // Use the correct API endpoint with proper rate limit handling
    const response = await retryWithBackoff<HeliusResponse>(async () => {
      const fetchResponse = await fetch(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'token-search',
          method: 'getAssetsByGroup',
          params: {
            groupKey: 'symbol',
            groupValue: query.toUpperCase(),
            page: 1,
            limit: 10
          }
        })
      });

      if (!fetchResponse.ok) {
        throw new Error(`Failed to fetch from Helius API: ${fetchResponse.statusText}`);
      }

      const data: HeliusResponse = await fetchResponse.json();
      if (data.error) {
        throw new Error(data.error.message || 'Helius API error');
      }

      return data;
    }, 3, 1000); // More retries with longer base delay

    if (!response?.result?.items) return [];

    return response.result.items
      .filter((asset): asset is HeliusAsset => Boolean(asset?.content?.metadata?.symbol)) // Only return tokens with symbols
      .map(asset => ({
        address: asset.id,
        name: asset.content.metadata.name || 'Unknown',
        symbol: asset.content.metadata.symbol || 'Unknown',
        source: 'helius-das',
        isNewToken: false,
        supply: asset.token_info?.supply?.toString() || '0',
        mintDate: asset.created_at ? new Date(asset.created_at) : undefined
      }));

  } catch (error) {
    console.error('Error searching tokens by symbol:', error);
    return [];
  }
}

export async function searchTokens(query: string): Promise<TokenInfo[]> {
  try {
    const results = new Map<string, TokenInfo>();
    const searchQuery = query.toLowerCase().trim();

    // First try direct symbol lookup for exact matches
    if (query.length <= 10) { // Only for reasonable ticker lengths
      const dasResults = await searchTokensBySymbol(query);
      for (const token of dasResults) {
        results.set(token.address, token);
      }

      // If we found exact matches, return them immediately
      if (results.size > 0) {
        return Array.from(results.values())
          .sort((a, b) => {
            // Exact symbol matches first
            const aExactMatch = a.symbol.toLowerCase() === searchQuery;
            const bExactMatch = b.symbol.toLowerCase() === searchQuery;
            if (aExactMatch && !bExactMatch) return -1;
            if (!aExactMatch && bExactMatch) return 1;
            return 0;
          });
      }
    }

    // If no direct matches found, check known tokens
    const knownTokenPromises = Object.entries(KNOWN_TOKENS)
      .filter(([symbol, tokenData]) => matchesTokenQuery(searchQuery, tokenData.name, symbol, tokenData.address))
      .map(async ([, tokenData]) => {
        const tokenInfo = await getTokenInfoFromMint(tokenData.address);
        if (tokenInfo) {
          tokenInfo.source = 'known';
          results.set(tokenData.address, tokenInfo);
        }
      });

    await Promise.all(knownTokenPromises);

    // Only if still no results, search recent transactions
    if (results.size === 0) {
      const recentSignatures = await retryWithBackoff(
        () => connection.getSignaturesForAddress(
          new PublicKey(TOKEN_PROGRAM_ID),
          { limit: 100 }
        ),
        2
      );

      // Process transactions in parallel batches
      const batchSize = 10;
      const batches: Array<Promise<void[]>> = [];
      
      for (let i = 0; i < recentSignatures.length && results.size < 50; i += batchSize) {
        const batch = recentSignatures.slice(i, i + batchSize);
        
        const batchPromise = Promise.all(
          batch.map(async (sig) => {
            try {
              let tx = transactionCache.get(sig.signature);
              if (!tx) {
                const parsedTx = await retryWithBackoff(
                  () => connection.getParsedTransaction(sig.signature, {
                    maxSupportedTransactionVersion: 0,
                    commitment: 'confirmed'
                  }),
                  2
                );
                
                if (parsedTx) {
                  tx = {
                    meta: {
                      postTokenBalances: parsedTx.meta?.postTokenBalances?.map(balance => ({
                        mint: balance.mint
                      }))
                    },
                    blockTime: parsedTx.blockTime
                  };
                  transactionCache.set(sig.signature, tx);
                  
                  if (transactionCache.size > 1000) {
                    const firstKey = Array.from(transactionCache.keys())[0];
                    if (firstKey) {
                      transactionCache.delete(firstKey);
                    }
                  }
                }
              }

              if (!tx?.meta?.postTokenBalances?.length) return;

              const mintPromises = tx.meta.postTokenBalances
                .map(balance => balance.mint)
                .filter((mintAddress): mintAddress is string => 
                  typeof mintAddress === 'string' &&
                  !results.has(mintAddress)
                )
                .map(async (mintAddress) => {
                  const tokenInfo = await getTokenInfoFromMint(mintAddress, tx.blockTime);
                  if (tokenInfo && matchesTokenQuery(searchQuery, tokenInfo.name, tokenInfo.symbol, mintAddress)) {
                    results.set(mintAddress, tokenInfo);
                  }
                });

              await Promise.all(mintPromises);
            } catch {
              // Skip error logging for faster processing
            }
          })
        );

        batches.push(batchPromise);
        
        if (batches.length === 3) {
          await Promise.all(batches);
          batches.length = 0;
          await delay(300);
        }
      }

      if (batches.length > 0) {
        await Promise.all(batches);
      }
    }

    // Sort and return results
    const allTokens = Array.from(results.values());
    return allTokens
      .sort((a, b) => {
        // Exact matches first
        const aExactMatch = a.symbol.toLowerCase() === searchQuery || a.name.toLowerCase() === searchQuery;
        const bExactMatch = b.symbol.toLowerCase() === searchQuery || b.name.toLowerCase() === searchQuery;
        if (aExactMatch && !bExactMatch) return -1;
        if (!aExactMatch && bExactMatch) return 1;

        // Then known tokens
        if (a.source === 'known' && b.source !== 'known') return -1;
        if (a.source !== 'known' && b.source === 'known') return 1;
        
        // Then by mint date
        if (!a.mintDate && !b.mintDate) return 0;
        if (!a.mintDate) return 1;
        if (!b.mintDate) return -1;
        return b.mintDate.getTime() - a.mintDate.getTime();
      })
      .slice(0, 50);

  } catch (error) {
    console.error('Error in searchTokens:', error);
    throw error;
  }
}

export async function getTokenDetails(address: string): Promise<TokenInfo | null> {
  try {
    let mintDate: Date | undefined;
    
    // Get mint date from on-chain data
    try {
      const signatures = await connection.getSignaturesForAddress(
        new PublicKey(address),
        { limit: 10 }
      );

      if (signatures.length > 0) {
        // Sort to get the earliest transaction
        const sortedSigs = signatures.sort((a, b) => 
          (a.blockTime || 0) - (b.blockTime || 0)
        );
        
        const tx = await connection.getTransaction(sortedSigs[0].signature);
        mintDate = tx?.blockTime ? new Date(tx.blockTime * 1000) : undefined;
      }
    } catch (error) {
      console.error('Error fetching token mint date:', error);
    }

    // Get token data
    try {
      const tokenInfo = await connection.getParsedAccountInfo(new PublicKey(address));
      if (!tokenInfo.value?.data || typeof tokenInfo.value.data !== 'object') return null;
      
      const data = tokenInfo.value.data;
      if ('parsed' in data && data.parsed.type === 'mint') {
        const tokenData = data.parsed.info;
        const isNewToken = mintDate ? 
          (new Date().getTime() - mintDate.getTime() <= 24 * 60 * 60 * 1000) : 
          false;
        
        return {
          address: address,
          name: tokenData.name || 'Unknown',
          symbol: tokenData.symbol || 'Unknown',
          source: 'on-chain',
          mintDate,
          isNewToken
        };
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