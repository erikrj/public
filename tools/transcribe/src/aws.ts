import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';

/** Returns the AWS account id for the active credentials. */
export async function getAccountId(region: string): Promise<string> {
  const sts = new STSClient({ region });
  const identity = await sts.send(new GetCallerIdentityCommand({}));
  if (!identity.Account) {
    throw new Error('unable to resolve AWS account id from caller identity');
  }
  return identity.Account;
}
