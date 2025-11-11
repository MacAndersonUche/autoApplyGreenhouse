// Type declarations for the bot module
// Export the type so it can be imported directly
export class GreenhouseAutoApplyBot {
  constructor();
  run(): Promise<void>;
  failedSubmissions: Array<{ jobTitle: string; url: string; timestamp: string; reason: string }>;
  failedApplications: Array<{ jobTitle: string; url: string; timestamp: string; reason: string }>;
}

// Also declare modules for runtime imports
declare module '../../../dist/index.js' {
  export { GreenhouseAutoApplyBot };
}

declare module '../../src/index.js' {
  export { GreenhouseAutoApplyBot };
}

// Ensure AWS SDK types are available
declare module '@aws-sdk/client-secrets-manager' {
  export class SecretsManagerClient {
    constructor(config?: any);
    send(command: any): Promise<any>;
  }
  export class GetSecretValueCommand {
    constructor(params: { SecretId: string });
  }
}

declare module '@aws-sdk/client-s3' {
  export class S3Client {
    constructor(config?: any);
    send(command: any): Promise<any>;
  }
  export class GetObjectCommand {
    constructor(params: { Bucket: string; Key: string });
  }
  export class PutObjectCommand {
    constructor(params: { Bucket: string; Key: string; Body: any; ContentType?: string });
  }
}

declare module '@aws-sdk/client-sqs' {
  export class SQSClient {
    constructor(config?: any);
    send(command: any): Promise<any>;
  }
  export class SendMessageCommand {
    constructor(params: { QueueUrl: string; MessageBody: string });
  }
}

declare module 'aws-lambda' {
  export interface EventBridgeEvent<T extends string, D = any> {
    version: string;
    id: string;
    'detail-type': T;
    source: string;
    account: string;
    time: string;
    region: string;
    resources: string[];
    detail: D;
  }
}

