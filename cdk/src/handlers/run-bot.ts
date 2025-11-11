import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { GreenhouseAutoApplyBot } from '../helpers/index';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
    console.log('Starting bot execution...');
    const bot = new GreenhouseAutoApplyBot();
    const stats = await bot.runWithStats();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        ...stats,
      }),
    };
  } catch (error: any) {
    console.error('Error running bot:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message || 'Unknown error occurred',
        jobsFound: 0,
        jobsApplied: 0,
        jobsFailed: 0,
        failedJobs: [],
      }),
    };
  }
};
