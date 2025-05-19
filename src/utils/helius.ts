import { Connection, PublicKey } from '@solana/web3.js';

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

// Use Helius RPC endpoint for better performance
const HELIUS_API_KEY = process.env.NEXT_PUBLIC_HELIUS_API_KEY;
if (!HELIUS_API_KEY) {
  throw new Error('NEXT_PUBLIC_HELIUS_API_KEY is not set in environment variables');
}

const HELIUS_URL = `https://api.helius.xyz/v0`;  // Fixed API URL
const connection = new Connection(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`, {
  commitment: 'confirmed'
});

// Helper function to add delay between requests
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Interface for Helius token metadata response
interface HeliusTokenMetadata {
  mint: string;
  onChainMetadata: {
    metadata?: {
      name?: string;
      symbol?: string;
      uri?: string;
    };
    tokenInfo?: {
      supply?: string;
    };
  };
  offChainMetadata?: {
    name?: string;
    symbol?: string;
  };
}

// Helper function for Helius API calls
async function fetchHelius<T>(endpoint: string, data?: unknown): Promise<T> {
  const url = `${HELIUS_URL}${endpoint}?api-key=${HELIUS_API_KEY}`;
  let retries = 3;
  let lastError: Error | null = null;

  while (retries >= 0) {
    try {
      const response = await fetch(url, {
        method: data ? 'POST' : 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        body: data ? JSON.stringify(data) : undefined,
      });

      if (!response.ok) {
        throw new Error(`Helius API error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      if (!result) {
        throw new Error('Empty response from API');
      }

      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`API call failed, retries left: ${retries}`, lastError.message);
      
      if (retries > 0) {
        const delayMs = 500 * (3 - retries) + Math.random() * 200;
        await delay(delayMs);
      }
      
      retries--;
    }
  }
  
  throw lastError;
}

// Enhanced token matching to find more related tokens
function matchesTokenQuery(query: string, name: string, symbol: string, address: string): boolean {
  query = query.toLowerCase().trim();
  name = name.toLowerCase().trim();
  symbol = symbol.toLowerCase().trim();
  address = address.toLowerCase().trim();

  // Break query into words for more flexible matching
  const queryWords = query.split(/[\s_-]+/);
  const nameWords = name.split(/[\s_-]+/);
  const symbolWords = symbol.split(/[\s_-]+/);

  // Exact matches first
  if (symbol === query || name === query || address === query) {
    return true;
  }

  // Check if any query word is contained in name or symbol
  for (const word of queryWords) {
    if (word.length < 2) continue; // Skip very short words
    
    // Check for variations of the word in name and symbol
    const variations = [
      word,
      word + 's',
      word.replace(/s$/, ''),
      word + '2',
      word + '3',
      word + 'inu',
      word + 'sol',
      'sol' + word,
      word + 'coin',
      word + 'token',
    ];

    for (const variation of variations) {
      if (name.includes(variation) || symbol.includes(variation)) {
        return true;
      }
    }

    // Check each word in name and symbol
    for (const nameWord of nameWords) {
      if (nameWord.includes(word) || word.includes(nameWord)) {
        return true;
      }
    }
    for (const symbolWord of symbolWords) {
      if (symbolWord.includes(word) || word.includes(symbolWord)) {
        return true;
      }
    }
  }

  // Check for common token naming patterns
  const commonPatterns = [
    query + 'inu',
    query + 'sol',
    'sol' + query,
    query + 'coin',
    query + 'token',
    query + '2',
    query + '3',
  ];

  for (const pattern of commonPatterns) {
    if (name.includes(pattern) || symbol.includes(pattern)) {
      return true;
    }
  }

  // Partial matches
  return symbol.includes(query) || 
         query.includes(symbol) ||
         name.includes(query) ||
         address.includes(query);
}

// Time range options for historical search
export type TimeRange = '24h' | '7d' | '30d' | 'all';

// Helper function to get milliseconds for time range
function getTimeRangeInMs(range: TimeRange): number {
  switch (range) {
    case '24h':
      return 24 * 60 * 60 * 1000;
    case '7d':
      return 7 * 24 * 60 * 60 * 1000;
    case '30d':
      return 30 * 24 * 60 * 60 * 1000;
    case 'all':
      return Number.MAX_SAFE_INTEGER;
  }
}

export async function searchTokens(query: string, timeRange: TimeRange = '24h'): Promise<TokenInfo[]> {
  try {
    console.log('Starting token search for:', query, 'timeRange:', timeRange);
    const results = new Map<string, TokenInfo>();
    const searchQuery = query.toLowerCase();
    const timeRangeMs = getTimeRangeInMs(timeRange);
    const currentTime = new Date().getTime();

    // Search for tokens using Helius API
    try {
      const searchResults = await fetchHelius<HeliusTokenMetadata[]>('/v0/token-metadata/search', {
        query: searchQuery,
        limit: 100,
      });

      if (Array.isArray(searchResults)) {
        for (const token of searchResults) {
          if (!token.mint || results.has(token.mint)) continue;

          try {
            // Get mint date if available
            let mintDate: Date | undefined;
            try {
              const signatures = await connection.getSignaturesForAddress(
                new PublicKey(token.mint),
                { limit: 1 }
              );
              if (signatures[0]?.blockTime) {
                mintDate = new Date(signatures[0].blockTime * 1000);
              }
            } catch (error) {
              console.error('Error fetching mint date:', error);
            }

            const metadata = token.onChainMetadata;
            const offChainMetadata = token.offChainMetadata;

            const tokenInfo: TokenInfo = {
              address: token.mint,
              name: metadata?.metadata?.name || offChainMetadata?.name || 'Unknown',
              symbol: metadata?.metadata?.symbol || offChainMetadata?.symbol || 'Unknown',
              source: 'on-chain',
              isNewToken: mintDate ? (currentTime - mintDate.getTime() <= timeRangeMs) : false,
              mintDate,
              supply: metadata?.tokenInfo?.supply?.toString() || '0',
              metadata: {
                name: metadata?.metadata?.name || offChainMetadata?.name || 'Unknown',
                symbol: metadata?.metadata?.symbol || offChainMetadata?.symbol || 'Unknown',
                uri: metadata?.metadata?.uri
              }
            };

            // Only include tokens that match our criteria
            if (matchesTokenQuery(searchQuery, tokenInfo.name, tokenInfo.symbol, tokenInfo.address)) {
              results.set(token.mint, tokenInfo);
            }
          } catch (error) {
            console.error('Error processing search result:', error);
          }
        }
      }
    } catch (error) {
      console.error('Error searching tokens:', error);
    }

    console.log('Search completed, total results:', results.size);

    // Sort and return results
    const allTokens = Array.from(results.values());
    return allTokens
      .sort((a, b) => {
        // Sort by mint date
        if (!a.mintDate && !b.mintDate) return 0;
        if (!a.mintDate) return 1;
        if (!b.mintDate) return -1;
        return b.mintDate.getTime() - a.mintDate.getTime();
      })
      .slice(0, 100);

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

    // Get token data using Helius API
    try {
      const tokenMetadata = await fetchHelius<HeliusTokenMetadata[]>('/token-metadata', {
        mintAccounts: [address],
        includeOffChain: true,
      });

      if (tokenMetadata?.[0]) {
        const metadata = tokenMetadata[0].onChainMetadata;
        const offChainMetadata = tokenMetadata[0].offChainMetadata;
        const isNewToken = mintDate ? 
          (new Date().getTime() - mintDate.getTime() <= 24 * 60 * 60 * 1000) : 
          false;
        
        return {
          address: address,
          name: metadata?.metadata?.name || offChainMetadata?.name || 'Unknown',
          symbol: metadata?.metadata?.symbol || offChainMetadata?.symbol || 'Unknown',
          source: 'on-chain',
          mintDate,
          isNewToken,
          metadata: {
            name: metadata?.metadata?.name || offChainMetadata?.name || 'Unknown',
            symbol: metadata?.metadata?.symbol || offChainMetadata?.symbol || 'Unknown',
            uri: metadata?.metadata?.uri
          }
        };
      }
    } catch (error) {
      console.error('Error getting token metadata:', error);
    }

    return null;
  } catch (error) {
    console.error('Error getting token details:', error);
    throw error;
  }
} 