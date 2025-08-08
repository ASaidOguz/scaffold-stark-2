import { InvalidJSONError } from "~~/utils/simpleNFT/ipfs";

// IPFS gateways to try (server-side, no CORS issues)
const IPFS_GATEWAYS = [

  {
    url: "https://gateway.pinata.cloud/ipfs/",
    name: "Pinata Public",
    requiresAuth: false
  },
  {
    url: "https://ipfs.io/ipfs/",
    name: "IPFS.io",
    requiresAuth: false
  },
  {
    url: "https://cloudflare-ipfs.com/ipfs/",
    name: "Cloudflare",
    requiresAuth: false
  },
  {
    url: "https://dweb.link/ipfs/",
    name: "Protocol Labs",
    requiresAuth: false
  }
];

// Cache for successful fetches
const metadataCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const ipfsHash = url.searchParams.get('hash');

    if (!ipfsHash) {
      return Response.json(
        { error: "ipfsHash parameter is required" },
        { status: 400 }
      );
    }

    const validation = validateIpfsHash(ipfsHash);
    if (!validation.valid) {
      return Response.json({ error: validation.error }, { status: 400 });
    }

    // Check cache first
    const cached = metadataCache.get(ipfsHash);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      console.log(`Cache hit for hash: ${ipfsHash}`);
      return Response.json(cached.data, { status: 200 });
    }

    // Try to fetch from IPFS gateways
    const metadata = await fetchFromIPFSGateways(ipfsHash);
    
    if (metadata === null) {
      return Response.json(
        { error: "IPFS hash not found in any gateway" },
        { status: 404 }
      );
    }

    // Cache successful result
    metadataCache.set(ipfsHash, { data: metadata, timestamp: Date.now() });

    return Response.json(metadata, { status: 200 });

  } catch (error: any) {
    console.error("Error getting metadata from IPFS:", error);

    if (error instanceof InvalidJSONError) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    if (error?.message?.includes('timeout')) {
      return Response.json(
        { error: "Request timed out while fetching from IPFS" },
        { status: 503 }
      );
    }

    return Response.json(
      { error: "Failed to fetch metadata from IPFS" },
      { status: 500 }
    );
  }
}

async function fetchFromIPFSGateways(ipfsHash: string): Promise<any> {
  const maxRetries = 2;
  let lastError: Error | null = null;

  // Try each gateway
  for (const gateway of IPFS_GATEWAYS) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Trying ${gateway.name} (attempt ${attempt + 1})`);
        
        const result = await fetchFromSingleGateway(gateway, ipfsHash);
        if (result !== null) {
          console.log(`✅ Success with ${gateway.name}`);
          return result;  // <-- EARLY RETURN here to stop retries on success
        }
      } catch (error: any) {
        lastError = error;
        console.warn(`❌ ${gateway.name} failed (attempt ${attempt + 1}):`, error.message);
        
        // Wait before retry (exponential backoff)
        if (attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
  }

  // If we get here, all gateways failed
  throw lastError || new Error("All IPFS gateways failed");
}

async function fetchFromSingleGateway(
  gateway: typeof IPFS_GATEWAYS[0], 
  ipfsHash: string
): Promise<any> {
  const url = `${gateway.url}${ipfsHash}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000); // 20 second timeout

  try {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'User-Agent': 'NFT-Factory/1.0',
    };

  

    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status === 404) {
        console.log(`Hash not found in ${gateway.name}`);
        return null;
      }
      
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Check if we got content
    const contentLength = response.headers.get('content-length');
    if (contentLength === '0') {
      throw new Error('Empty response');
    }

    const responseText = await response.text();
    
    if (!responseText || responseText.trim() === '') {
      throw new Error('Empty response body');
    }

    // Parse JSON
    try {
      const jsonData = JSON.parse(responseText);
      
      // Basic validation
      if (typeof jsonData === 'object' && jsonData !== null) {
        return jsonData;
      } else {
        throw new InvalidJSONError('Invalid metadata format');
      }
    } catch (parseError) {
      console.error(`JSON parse error from ${gateway.name}:`, parseError);
      console.log(`Response preview: "${responseText.substring(0, 200)}"`);
      throw new InvalidJSONError(`Invalid JSON from ${gateway.name}`);
    }

  } catch (error: any) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError') {
      throw new Error(`Timeout after 20s`);
    }

    throw error;
  }
}

function validateIpfsHash(ipfsHash: string) {
  if (!ipfsHash || typeof ipfsHash !== 'string') {
    return {
      valid: false,
      error: "Invalid input: ipfsHash is required and must be a string",
    };
  }

  // IPFS hash validation (more comprehensive)
  const ipfsHashRegex = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[A-Za-z2-7]{58}|B[A-Z2-7]{58}|z[1-9A-HJ-NP-Za-km-z]{48}|F[0-9A-F]{50})$/;
  
  if (!ipfsHashRegex.test(ipfsHash)) {
    return {
      valid: false,
      error: "Invalid IPFS hash format",
    };
  }

  return {
    valid: true,
    error: null,
  };
}
