# Solana Token Explorer

A web application to find and track non-public contract addresses on the Solana blockchain, including those with attached tickers that aren't easily discoverable through regular explorers.

## Features

- Search for tokens by ticker symbol
- View detailed token information including:
  - Contract address
  - Token name
  - Ticker symbol
  - Mint time
  - Creator address
- Modern, responsive UI
- Real-time search results
- Powered by Helius API

## Prerequisites

- Node.js 18.x or later
- A Helius API key ([Get one here](https://dev.helius.xyz/))

## Setup

1. Clone the repository:
```bash
git clone <your-repo-url>
cd sol-track
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env.local` file in the root directory and add your Helius API key:
```
NEXT_PUBLIC_HELIUS_API_KEY=your_helius_api_key_here
NEXT_PUBLIC_HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=your_helius_api_key_here
```

4. Start the development server:
```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Technology Stack

- Next.js 14
- TypeScript
- Tailwind CSS
- Helius SDK
- Web3.js
- date-fns

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT
