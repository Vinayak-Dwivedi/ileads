import { NextResponse } from "next/server";
import { getSignedDownloadUrl } from "@/lib/s3";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get("key");

    if (!key) {
      return NextResponse.json(
        { error: "S3 object key is required as a 'key' query parameter." },
        { status: 400 },
      );
    }

    // Generate signed URL valid for 5 minutes (300 seconds)
    const signedUrl = await getSignedDownloadUrl(key, 300);

    return NextResponse.json({
      success: true,
      url: signedUrl,
      expiresIn: 300,
    });
  } catch (error) {
    console.error("S3 Get Audio API Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Internal Server Error",
      },
      { status: 500 },
    );
  }
}
