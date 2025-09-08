import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';

const lambdaClient = new LambdaClient();

async function invoke(input: { arn: string; cctx?: string; data?: string }) {
  const dataBuf = input.data && Buffer.from(input.data);
  const cctxBuf = input.cctx && Buffer.from(input.cctx).toString('base64');

  const { Payload, FunctionError } = await lambdaClient.send(
    new InvokeCommand({
      FunctionName: input.arn,
      ...(!!dataBuf && { Payload: dataBuf }),
      ...(!!cctxBuf && { ClientContext: cctxBuf })
    })
  );

  const payload = Payload?.transformToString();
  const json = payload && JSON.parse(payload);

  if (FunctionError) throw new Error(json);

  try {
    return json.body && JSON.parse(json.body);
  } catch (_) {
    return json.body;
  }
}

export { invoke };
