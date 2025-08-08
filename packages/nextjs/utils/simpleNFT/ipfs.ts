// in `~~/utils/simpleNFT/ipfs.ts`

export class InvalidJSONError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidJSONError";
  }
}

export const addToIPFS = (yourJSON: object) =>
  fetchWithTimeout("/api/ipfs/add", "POST", yourJSON);

// Use your dedicated Pinata gateway URL and fallbacks
const PINATA_GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL;
const PINATA_GATEWAY_TOKEN = process.env.PINATA_GATEWAY_TOKEN

// Fallback gateways for better reliability
const FALLBACK_GATEWAYS = [
  "https://gateway.pinata.cloud/ipfs/",
  "https://ipfs.io/ipfs/",
];

// Cache for successful fetches to avoid repeated requests
const metadataCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export async function getNFTMetadataFromIPFS(ipfsHash: string, retryAttempt: number = 0): Promise<any> {
  // Check cache first
  const cached = metadataCache.get(ipfsHash);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    console.log(`Using cached metadata for hash: ${ipfsHash}`);
    return cached.data;
  }

  const maxRetries = 3;
  const baseDelay = 3000; // 1 second base delay
  
  console.log(`Fetching metadata for hash: ${ipfsHash} (attempt ${retryAttempt + 1})`);

  try {
    // Try primary gateway first
    if (!PINATA_GATEWAY_URL) {
      throw new Error("Pinata gateway URL is not configured");
    }
    const result = await tryFetchFromGateway(PINATA_GATEWAY_URL, ipfsHash, true);
    if (result !== null) {
      // Cache successful result
      metadataCache.set(ipfsHash, { data: result, timestamp: Date.now() });
      return result;
    }
  } catch (error) {
    console.log(`Primary gateway failed for ${ipfsHash}:`, error);
  }

  // Try primary gateway without auth
  try {
       if (!PINATA_GATEWAY_URL) {
      throw new Error("Pinata gateway URL is not configured");
    }
    const result = await tryFetchFromGateway(PINATA_GATEWAY_URL, ipfsHash, false);
    if (result !== null) {
      metadataCache.set(ipfsHash, { data: result, timestamp: Date.now() });
      return result;
    }
  } catch (error) {
    console.log(`Primary gateway (no auth) failed for ${ipfsHash}:`, error);
  }

  // Try fallback gateways
  for (const gateway of FALLBACK_GATEWAYS) {
    try {
      console.log(`Trying fallback gateway: ${gateway}`);
      const result = await tryFetchFromGateway(gateway, ipfsHash, false);
      if (result !== null) {
        console.log(`Success with fallback gateway: ${gateway}`);
        metadataCache.set(ipfsHash, { data: result, timestamp: Date.now() });
        return result;
      }
    } catch (error) {
      console.log(`Fallback gateway ${gateway} failed:`, error);
      continue;
    }
  }

  // If all gateways fail and we haven't exceeded retry limit, wait and retry
  if (retryAttempt < maxRetries) {
    const delay = baseDelay * Math.pow(2, retryAttempt); // Exponential backoff
    console.log(`All gateways failed, retrying in ${delay}ms... (attempt ${retryAttempt + 1}/${maxRetries})`);
    
    await new Promise(resolve => setTimeout(resolve, delay));
    return getNFTMetadataFromIPFS(ipfsHash, retryAttempt + 1);
  }

  // If we've exhausted all retries
  throw new Error(`Failed to fetch metadata from all gateways after ${maxRetries} attempts for hash: ${ipfsHash}`);
}

async function tryFetchFromGateway(
  gatewayUrl: string, 
  ipfsHash: string, 
  useAuth: boolean = false,
  timeoutMs: number = 10000
): Promise<any> {
  const url = `/api/ipfs/get-metadata?hash=${ipfsHash}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
    };

    if (useAuth && PINATA_GATEWAY_TOKEN) {
      
      headers['Authorization'] = `Bearer ${PINATA_GATEWAY_TOKEN}`;
    }

    const response = await fetch(url, {
      signal: controller.signal,
      headers,
      method: 'GET',
      mode: 'cors',
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status === 404) {
        console.warn(`Metadata not found for hash: ${ipfsHash} at ${gatewayUrl}`);
        return null;
      }
      
      if (response.status === 401 || response.status === 403) {
        throw new Error(`Authentication/Access error: ${response.status} ${response.statusText}`);
      }
      
      if (response.status >= 500) {
        throw new Error(`Gateway server error: ${response.status} ${response.statusText}`);
      }
      
      throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
    }

    // Check if we actually got content
    const contentLength = response.headers.get('content-length');
    if (contentLength === '0') {
      throw new Error('Empty response from gateway');
    }

    // Get response text
    const responseText = await response.text();
    
    if (!responseText || responseText.trim() === '') {
      throw new Error('Empty response body');
    }

    // Try to parse as JSON
    try {
      const jsonObject = JSON.parse(responseText);
      
      // Basic validation - ensure it's actually metadata-like
      if (typeof jsonObject === 'object' && jsonObject !== null) {
        console.log(`Successfully fetched metadata for ${ipfsHash} from ${gatewayUrl}`);
        return jsonObject;
      } else {
        throw new InvalidJSONError('Response is not a valid metadata object');
      }
    } catch (parseError) {
      console.error(`JSON parse error for ${ipfsHash}:`, parseError);
      console.log(`Response text (first 200 chars): "${responseText.substring(0, 200)}"`);
      throw new InvalidJSONError(`Invalid JSON content for hash: ${ipfsHash}`);
    }

  } catch (error: any) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }

    if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
      throw new Error(`Network error: Unable to connect to ${gatewayUrl}`);
    }

    // Re-throw our custom errors
    throw error;
  }
}

const fetchWithTimeout = async (
  path: string,
  method: string,
  body?: object,
  timeout: number = 10000 // Increased timeout
) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(path, {
      method,
      headers: {
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const data = await response.json();

    if (!response.ok) {
      const errorMessage = data?.error || `HTTP ${response.status} error`;
      const error = new Error(errorMessage);
      (error as any).status = response.status;
      throw error;
    }

    return data;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === "AbortError") {
      throw new Error("Request timed out");
    }
    if (error.status) {
      throw error;
    }
    console.error("Network Error:", error);
    throw new Error("Network error: Unable to connect to server");
  }
};

// Utility function to pre-warm cache for multiple hashes
export async function preloadMetadata(hashes: string[]): Promise<void> {
  const promises = hashes.map(hash => 
    getNFTMetadataFromIPFS(hash).catch(error => {
      console.warn(`Failed to preload metadata for ${hash}:`, error);
      return null;
    })
  );
  
  await Promise.allSettled(promises);
  console.log(`Preloaded metadata for ${hashes.length} hashes`);
}

// Utility to clear cache
export function clearMetadataCache(): void {
  metadataCache.clear();
  console.log('Metadata cache cleared');
}