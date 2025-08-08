import { NextResponse, type NextRequest } from "next/server";
import { pinata } from "~~/app/api/config";

export async function POST(request: NextRequest) {
  try {
    // Parse JSON data from request body instead of formData
    const metadata = await request.json();
    
    // Validate that we received some data
    if (!metadata || Object.keys(metadata).length === 0) {
      return NextResponse.json(
        { error: "No metadata provided" },
        { status: 400 }
      );
    }

    // Upload JSON metadata to IPFS using Pinata
    const result = await pinata.upload.public.json(metadata);
    
    return NextResponse.json({
      success: true,
      cid: result.cid,
      metadata: metadata
    }, { status: 200 });

  } catch (e) {
    console.log("Upload error:", e);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}