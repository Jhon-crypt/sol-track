import { Helius } from 'helius-sdk';

const helius = new Helius(process.env.NEXT_PUBLIC_HELIUS_API_KEY!);

export interface TokenMetadata {
  name?: string;
  symbol?: string;
  description?: string;
  image?: string;
  attributes?: Array<{
    trait_type: string;
    value: string;
  }>;
  [key: string]: any;
}

export interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  mintTime?: string;
  creatorAddress?: string;
  metadata?: TokenMetadata;
}

export async function searchTokens(ticker: string): Promise<TokenInfo[]> {
  try {
    // Search for tokens using the Asset API
    const assets = await helius.searchAssets({
      ownerAddress: undefined,
      compressed: false,
      burnt: false,
      limit: 100,
      page: 1,
      displayOptions: {
        showCollectionMetadata: true,
        showNativeBalance: true,
      }
    });

    // Filter and map the results
    const tokens = assets
      .filter(asset => {
        const symbol = asset.content?.metadata?.symbol || '';
        return symbol.toLowerCase().includes(ticker.toLowerCase());
      })
      .map(asset => ({
        address: asset.id,
        name: asset.content?.metadata?.name || 'Unknown',
        symbol: asset.content?.metadata?.symbol || 'Unknown',
        mintTime: asset.createdAt,
        creatorAddress: asset.authorities?.[0]?.address,
        metadata: asset.content?.metadata
      }));

    return tokens;
  } catch (error) {
    console.error('Error searching tokens:', error);
    throw error;
  }
}

export async function getTokenDetails(address: string): Promise<TokenInfo | null> {
  try {
    const asset = await helius.getAsset({ id: address });
    
    if (!asset) return null;

    return {
      address: asset.id,
      name: asset.content?.metadata?.name || 'Unknown',
      symbol: asset.content?.metadata?.symbol || 'Unknown',
      mintTime: asset.createdAt,
      creatorAddress: asset.authorities?.[0]?.address,
      metadata: asset.content?.metadata
    };
  } catch (error) {
    console.error('Error getting token details:', error);
    throw error;
  }
} 