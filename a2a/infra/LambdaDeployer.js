/**
 * @fileoverview Lambda deployment module for the Healthylinkx A2A server.
 * This module provides a class for deploying and updating Lambda functions.
 * @module LambdaDeployer
 */

import {
  LambdaClient,
  CreateFunctionCommand,
  UpdateFunctionCodeCommand,
  UpdateFunctionConfigurationCommand,
  GetFunctionConfigurationCommand,
  CreateFunctionUrlConfigCommand,
  UpdateFunctionUrlConfigCommand,
  GetFunctionUrlConfigCommand,
  AddPermissionCommand
} from "@aws-sdk/client-lambda";
import { IAMClient, GetRoleCommand, CreateRoleCommand, AttachRolePolicyCommand } from "@aws-sdk/client-iam";
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';

import util from 'util';
const writeFileAsync = util.promisify(fs.writeFile);

/**
 * Class representing a Lambda function deployer.
 */
export default class LambdaDeployer {
  /**
   * Create a LambdaDeployer.
   */
  constructor() {
    // Read the config file
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const configPath = path.join(__dirname, '../..', 'config.json');
    const rawConfig = fs.readFileSync(configPath);
    const config = JSON.parse(rawConfig);

    // Extract the function name and role name from the config
    this.FUNCTION_NAME = config.a2a.functionName;
    this.ROLE_NAME = config.a2a.roleName;

    this.REGION = process.env.AWS_REGION || "us-east-1";
  }

  /**
   * Creates an IAM role for the Lambda function.
   * @returns {Promise<string>} The ARN of the created or existing role.
   * @throws {Error} If role creation fails.
   */
  async createLambdaRole() {
    const rolePolicy = {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: {
            Service: "lambda.amazonaws.com"
          },
          Action: "sts:AssumeRole"
        }
      ]
    };

    const iam = new IAMClient({ region: this.REGION });
    try {
      const getRoleCommand = new GetRoleCommand({ RoleName: this.ROLE_NAME });
      const { Role } = await iam.send(getRoleCommand);
      return Role.Arn;
    } catch (error) {
      if (error.name === "NoSuchEntityException") {
        const createRoleCommand = new CreateRoleCommand({
          RoleName: this.ROLE_NAME,
          AssumeRolePolicyDocument: JSON.stringify(rolePolicy)
        });
        const { Role } = await iam.send(createRoleCommand);

        await this.attachPolicies(this.ROLE_NAME);

        // Wait for the role to be available
        await new Promise(resolve => setTimeout(resolve, 10000));

        return Role.Arn;
      }
      throw error;
    }
  }

  /**
   * Attaches necessary policies to the IAM role.
   * @param {string} roleName - The name of the IAM role.
   * @returns {Promise<void>}
   */
  async attachPolicies(roleName) {
    const iam = new IAMClient({ region: this.REGION });
    await iam.send(new AttachRolePolicyCommand({
      RoleName: roleName,
      PolicyArn: "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
    }));

    // NOTE: kept consistent with MCP lambda for now.
    await iam.send(new AttachRolePolicyCommand({
      RoleName: roleName,
      PolicyArn: "arn:aws:iam::aws:policy/AmazonBedrockFullAccess"
    }));

    await iam.send(new AttachRolePolicyCommand({
      RoleName: roleName,
      PolicyArn: "arn:aws:iam::aws:policy/AmazonRDSFullAccess"
    }));
  }

  /**
   * Creates or updates the function URL for the Lambda.
   * @param {string} functionName - The name of the Lambda function.
   * @returns {Promise<void>}
   * @throws {Error} If function URL creation or update fails.
   */
  async createFunctionUrl(functionName) {
    const lambda = new LambdaClient({ region: this.REGION });
    try {
      // Check if function URL already exists
      const getFunctionUrlCommand = new GetFunctionUrlConfigCommand({ FunctionName: functionName });
      await lambda.send(getFunctionUrlCommand);

      // If it exists, update it
      const updateFunctionUrlCommand = new UpdateFunctionUrlConfigCommand({
        FunctionName: functionName,
        AuthType: "NONE",
        Cors: {
          AllowCredentials: true,
          AllowHeaders: ["*"],
          AllowMethods: ["*"],
          AllowOrigins: ["*"],
          ExposeHeaders: ["*"],
          MaxAge: 86400
        }
      });
      const response = await lambda.send(updateFunctionUrlCommand);
      console.log("Function URL updated:", response.FunctionUrl);
      return response.FunctionUrl;
    } catch (error) {
      if (error.name === "ResourceNotFoundException") {
        // If it doesn't exist, create it
        const createFunctionUrlCommand = new CreateFunctionUrlConfigCommand({
          FunctionName: functionName,
          AuthType: "NONE",
          Cors: {
            AllowCredentials: true,
            AllowHeaders: ["*"],
            AllowMethods: ["*"],
            AllowOrigins: ["*"],
            ExposeHeaders: ["*"],
            MaxAge: 86400
          }
        });
        const response = await lambda.send(createFunctionUrlCommand);
        console.log("Function URL created:", response.FunctionUrl);
        return response.FunctionUrl;
      } else {
        throw error;
      }
    }

    // Add permission for public access
    await this.addFunctionUrlPermission(functionName);

    // Return the URL (if it already existed, fetch it)
    const existing = await lambda.send(new GetFunctionUrlConfigCommand({ FunctionName: functionName }));
    return existing.FunctionUrl;
  }

  /**
   * Adds permission for public access to the function URL.
   * @param {string} functionName - The name of the Lambda function.
   * @returns {Promise<void>}
   * @throws {Error} If adding permission fails.
   */
  async addFunctionUrlPermission(functionName) {
    try {
      const lambda = new LambdaClient({ region: this.REGION });
      const addPermissionCommand = new AddPermissionCommand({
        FunctionName: functionName,
        StatementId: "FunctionURLAllowPublicAccess",
        Action: "lambda:InvokeFunctionUrl",
        Principal: "*",
        FunctionUrlAuthType: "NONE"
      });

      await lambda.send(addPermissionCommand);
      console.log("Function URL public access permission added successfully");
    } catch (error) {
      if (error.name === "ResourceConflictException") {
        console.log("Function URL permission already exists");
      } else {
        throw error;
      }
    }
  }

  /**
   * Saves the function URL to a config file.
   * @param {string} functionName - The name of the Lambda function.
   * @returns {Promise<void>}
   * @throws {Error} If saving the config fails.
   */
  async SaveUrlInConfigFile(functionName) {
    const command = new GetFunctionUrlConfigCommand({ FunctionName: functionName });

    try {
      const lambda = new LambdaClient({ region: this.REGION });
      const response = await lambda.send(command);

      // Save the function URL to lambdaurl.json (written into the infra working directory)
      const lambdaurl = { LAMBDA_FUNCTION_URL: response.FunctionUrl };

      await writeFileAsync('lambdaurl.json', JSON.stringify(lambdaurl, null, 2));
      console.log(`Lambda url file updated at lambdaurl.json`);

    } catch (error) {
      console.error('Error creating and saving lambda url:', error);
      throw error;
    }
  }

  /**
   * Deploys the Lambda function.
   * @returns {Promise<void>}
   * @throws {Error} If deployment fails.
   */
  async deployLambda() {
    const zip = new AdmZip();
    zip.addLocalFolder("../src");
    const zipBuffer = zip.toBuffer();

    const roleArn = await this.createLambdaRole();

    const lambda = new LambdaClient({ region: this.REGION });

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const waitForLambdaReady = async () => {
      // Wait until the function is Active and the last update (if any) is Successful.
      // This prevents ResourceConflictException when calling UpdateFunctionConfiguration.
      const deadlineMs = Date.now() + 90_000;
      let delayMs = 750;
      while (Date.now() < deadlineMs) {
        try {
          const cfg = await lambda.send(
            new GetFunctionConfigurationCommand({ FunctionName: this.FUNCTION_NAME })
          );

          const state = cfg.State;
          const lastUpdateStatus = cfg.LastUpdateStatus;

          if (state === 'Active' && (!lastUpdateStatus || lastUpdateStatus === 'Successful')) {
            return;
          }
        } catch (e) {
          // If we can't read config transiently, keep waiting.
        }
        await sleep(delayMs);
        delayMs = Math.min(5000, Math.round(delayMs * 1.4));
      }
      console.warn('Timed out waiting for Lambda to become ready; proceeding anyway.');
    };

    const sendWithConflictRetry = async (commandFactory, label) => {
      // Retries only on ResourceConflictException (409) which Lambda throws when an update is in progress.
      let attempt = 0;
      let delayMs = 750;
      // up to ~60-90 seconds worst case
      while (attempt < 12) {
        try {
          await waitForLambdaReady();
          return await lambda.send(commandFactory());
        } catch (error) {
          if (error && (error.name === 'ResourceConflictException' || error.Code === 'ResourceConflictException')) {
            attempt += 1;
            console.log(`${label} delayed (update in progress). Retrying in ${delayMs}ms...`);
            await sleep(delayMs);
            delayMs = Math.min(7000, Math.round(delayMs * 1.5));
            continue;
          }
          throw error;
        }
      }
      throw new Error(`${label} failed: Lambda remained busy (ResourceConflictException)`);
    };

    try {
      const createFunctionCommand = new CreateFunctionCommand({
        FunctionName: this.FUNCTION_NAME,
        Runtime: "nodejs22.x",
        Role: roleArn,
        Handler: "index.handler",
        Code: { ZipFile: zipBuffer },
        Timeout: 30,
        MemorySize: 128,
        Environment: { Variables: {} }
      });

      await lambda.send(createFunctionCommand);
      console.log("Lambda function created successfully");
    } catch (error) {
      if (error.name === "ResourceConflictException") {
        console.log("Lambda function already exists. Updating code...");
        const updateFunctionCodeCommand = new UpdateFunctionCodeCommand({
          FunctionName: this.FUNCTION_NAME,
          ZipFile: zipBuffer
        });
        await lambda.send(updateFunctionCodeCommand);
        console.log("Lambda function code updated successfully");
      } else {
        throw error;
      }
    }

    // Ensure the update has settled before doing subsequent configuration changes.
    await waitForLambdaReady();

    // Create or update function URL
    const functionUrl = await this.createFunctionUrl(this.FUNCTION_NAME);
    await this.SaveUrlInConfigFile(this.FUNCTION_NAME);

    // Configure the agent card base URL to match the Function URL.
    // Trim trailing slash so we can safely append paths.
    const normalizedUrl = functionUrl.replace(/\/+$/, '');
    await sendWithConflictRetry(
      () =>
        new UpdateFunctionConfigurationCommand({
          FunctionName: this.FUNCTION_NAME,
          Environment: {
            Variables: {
              A2A_PUBLIC_BASE_URL: normalizedUrl
            }
          }
        }),
      'UpdateFunctionConfiguration(A2A_PUBLIC_BASE_URL)'
    );
    console.log(`Updated env A2A_PUBLIC_BASE_URL=${normalizedUrl}`);
  }
}
