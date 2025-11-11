import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { storage } from '../bot/storage';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: '',
    };
  }

  try {
    const failedJobs = await storage.getAll();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        failedJobs,
      }),
    };
  } catch (error: any) {
    console.error('Error loading failed jobs:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message || 'Unknown error occurred',
        failedJobs: [],
      }),
    };
  }
};
