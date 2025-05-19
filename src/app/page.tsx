'use client';

import { useState } from 'react';
import { searchTokens, TokenInfo } from '@/utils/helius';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';

export default function Home() {
  const [searchQuery, setSearchQuery] = useState('');
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const results = await searchTokens(searchQuery);
      setTokens(results);
    } catch (err) {
      setError('Failed to search tokens. Please try again.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen p-8 bg-black text-white">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-4">Solana Token Explorer</h1>
          <p className="text-gray-400">
            Search for any token by name or ticker to find its contract address
          </p>
        </div>

        <form onSubmit={handleSearch} className="mb-8">
          <div className="flex gap-4">
            <div className="flex-1 relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Enter token name or ticker (e.g., bonk)"
                className="w-full px-4 py-3 rounded-lg bg-gray-900 border border-gray-700 text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <MagnifyingGlassIcon className="h-5 w-5 absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500" />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Searching...' : 'Search'}
            </button>
          </div>
        </form>

        {error && (
          <div className="bg-red-900/50 text-red-200 p-4 rounded-lg mb-8 border border-red-800">
            {error}
          </div>
        )}

        {tokens.length > 0 && (
          <div className="space-y-4">
            {tokens.map((token) => (
              <div
                key={token.address}
                className="p-4 rounded-lg bg-gray-900 border border-gray-800"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-medium">{token.name}</h3>
                    <p className="text-gray-400">{token.symbol}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-400">Contract Address:</p>
                    <p className="font-mono text-blue-400">{token.address}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && tokens.length === 0 && searchQuery && (
          <div className="text-center py-8 text-gray-400">
            No tokens found matching &ldquo;{searchQuery}&rdquo;
          </div>
        )}
      </div>
    </main>
  );
}
