import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { fromContainerMetadata } from '@aws-sdk/credential-providers';
import { createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import { dirname } from 'path';

/**
 * Downloads a file from S3 to a local path
 * @param s3Path - The S3 path in format s3://bucket/key or just the key if bucket is in env
 * @param outputPath - The local file path where the file should be saved
 */
async function downloadFileFromS3(
  s3Path: string,
  outputPath: string
): Promise<void> {
  console.info(`Downloading S3 file from ${s3Path} to ${outputPath}`);

  try {
    // Initialize S3 client with container metadata credentials
    const credentials = fromContainerMetadata();
    const s3Client = new S3Client({
      region: process.env.AWS_REGION ?? 'us-east-1',
      credentials
    });

    // Parse S3 path to extract bucket and key
    let bucket: string;
    let key: string;

    if (s3Path.startsWith('s3://')) {
      const url = new URL(s3Path);
      bucket = url.hostname;
      key = url.pathname.slice(1); // Remove leading slash
    } else {
      // Assume path is just the key, bucket comes from environment
      bucket = process.env.VIDEO_ASSETS_BUCKET_NAME ?? '';
      key = s3Path;

      if (!bucket) {
        throw new Error(
          'VIDEO_ASSETS_BUCKET_NAME environment variable is required when S3 path does not include bucket'
        );
      }
    }

    console.info(`Downloading from bucket: ${bucket}, key: ${key}`);

    // Ensure output directory exists
    const outputDir = dirname(outputPath);
    await mkdir(outputDir, { recursive: true });

    // Create S3 get object command
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key
    });

    // Execute the command and get the response
    const response = await s3Client.send(command);

    if (!response.Body) {
      throw new Error('No body in S3 response');
    }

    // Create write stream to output file
    const writeStream = createWriteStream(outputPath);

    // Stream the S3 object body to the local file
    if (response.Body instanceof ReadableStream) {
      // Handle ReadableStream (Web Streams API)
      const reader = response.Body.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // Write chunk and wait for it to be written
          await new Promise<void>((resolve, reject) => {
            writeStream.write(value, (error) => {
              if (error) reject(error);
              else resolve();
            });
          });
        }
      } finally {
        reader.releaseLock();
      }

      // End the stream after all data has been written
      writeStream.end();

      // Wait for write stream to finish
      await new Promise<void>((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });
    } else {
      // Handle Node.js streams
      const body = response.Body as NodeJS.ReadableStream;

      // Use pipe and let it handle the stream lifecycle
      await new Promise<void>((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
        body.on('error', reject);

        // Pipe automatically ends the write stream when source ends
        body.pipe(writeStream);
      });
    }

    console.info(`Successfully downloaded file to ${outputDir}`);
  } catch (error) {
    console.error(`Failed to download file from S3: ${s3Path}`, error);
    throw error;
  }
}

export { downloadFileFromS3 };
