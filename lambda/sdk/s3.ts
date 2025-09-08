import {
  HeadObjectCommand,
  HeadObjectCommandOutput,
  S3Client
} from '@aws-sdk/client-s3';

const s3Client = new S3Client();

async function getS3File(
  objectName: string,
  bucketName: string
): Promise<HeadObjectCommandOutput> {
  return await s3Client.send(
    new HeadObjectCommand({
      Bucket: bucketName,
      Key: objectName
    })
  );
}

export { getS3File };
