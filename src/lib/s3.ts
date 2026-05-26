import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Retrieve config from environment variables
const region = process.env.AWS_REGION || "us-east-1";
const bucketName = process.env.AWS_BUCKET_NAME || "qms-calls-storage";

const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

// Reusable S3 Client instance
export const s3Client = new S3Client({
  region,
  credentials:
    accessKeyId && secretAccessKey
      ? {
          accessKeyId,
          secretAccessKey,
        }
      : undefined,
});

/**
 * Sanitizes a filename to prevent invalid S3 characters.
 */
function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^\w.\- ()]+/g, "_").slice(0, 180) || "audio-file";
}

/**
 * Formats a date into a directory structure like: YYYY-MM/DD
 */
function formatDateDirectory(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}/${dd}`;
}

/**
 * Uploads a buffer to the S3 bucket under the calls/YYYY-MM/DD/ structure.
 * 
 * @param fileBuffer The raw audio file buffer
 * @param fileName The original file name
 * @param contentType The MIME type of the file
 * @returns Object indicating success, the S3 key, and the file URL
 */
export async function uploadToS3(
  fileBuffer: Buffer,
  fileName: string,
  contentType: string,
): Promise<{ success: boolean; key: string; url: string }> {
  const date = new Date();
  const datePath = formatDateDirectory(date);
  const sanitized = sanitizeFileName(fileName);
  
  // Create a unique file name using a timestamp prefix to prevent name collisions
  const timestamp = Date.now();
  const storedFileName = `${timestamp}-${sanitized}`;
  
  // Format: calls/YYYY-MM/DD/123456789-file.mp3
  const key = `calls/${datePath}/${storedFileName}`;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: fileBuffer,
      ContentType: contentType,
    }),
  );

  // Fallback direct URL (will require bucket policies or credentials to access)
  const url = `https://${bucketName}.s3.${region}.amazonaws.com/${key}`;

  return {
    success: true,
    key,
    url,
  };
}

/**
 * Generates a temporary pre-signed URL for playing/downloading private S3 objects.
 * 
 * @param key The S3 object key
 * @param expiresInSeconds URL expiration time (defaults to 300 seconds / 5 minutes)
 * @returns The temporary signed URL
 */
export async function getSignedDownloadUrl(
  key: string,
  expiresInSeconds: number = 300,
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: key,
  });

  // Generate URL valid for 5 minutes
  return getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
}
