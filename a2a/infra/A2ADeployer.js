/**
 * @fileoverview Lambda deployment module for the A2A agent.
 * This module provides a class for deploying and updating Lambda functions.
 * @module A2ADeployer
 */

import {
  LambdaClient,
  CreateFunctionCommand,
  UpdateFunctionCodeCommand,
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
 * Class representing a Lambda function deployer for A2A agent.
 */
export default class A2ADeployer {
  /**
   * Create an A2ADeployer.
   */
  constructor() {
    // Read the config file
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const configPath = path.join(__dirname, '../..', 'config.json')
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
      } else {
        throw error;
      }
    }

    // Add permission for public access
    await this.addFunctionUrlPermission(functionName);
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

      // Save the function URL to lambdaurl.json
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
    try {
      const createFunctionCommand = new CreateFunctionCommand({
        FunctionName: this.FUNCTION_NAME,
        Runtime: "nodejs22.x",
        Role: roleArn,
        Handler: "run.sh",
        Code: { ZipFile: zipBuffer },
        Timeout: 30,
        MemorySize: 128,
        Environment: {
          Variables: { // Environment Variables
            "AWS_LAMBDA_EXEC_WRAPPER": "/opt/bootstrap"
          },
        },
        Layers: [ // LayerList
          `arn:aws:lambda:${this.REGION}:753240598075:layer:LambdaAdapterLayerX86:25`
        ]
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

    // Create or update function URL
    await this.createFunctionUrl(this.FUNCTION_NAME);
    await this.SaveUrlInConfigFile(this.FUNCTION_NAME);
  }
}
