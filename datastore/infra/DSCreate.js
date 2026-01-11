
import {
	RDSClient,
	CreateDBInstanceCommand,
	DescribeDBInstancesCommand
} from "@aws-sdk/client-rds";
import {
	EC2Client,
	CreateSecurityGroupCommand,
	AuthorizeSecurityGroupIngressCommand
} from "@aws-sdk/client-ec2";

import mysql from 'mysql2/promise';
import * as fs from 'fs'; 
import * as path from 'path';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';

// Read the config file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configPath = path.join(__dirname, '../..', 'config.json')
const rawConfig = fs.readFileSync(configPath);
const config = JSON.parse(rawConfig);

// Extract configurations
const DBUSER = config.datastore.user;
const DBPWD = config.datastore.passwd;

// ======== helper function ============
function sleep(secs) {
	return new Promise(resolve => setTimeout(resolve, secs * 1000));
}

// ====== create MySQL database and add data =====
async function LoadData() {
	try{			
		// Create an RDS client service object
		const rdsclient = new RDSClient({});
		
		//URL of the instance
		const data = await rdsclient.send(new DescribeDBInstancesCommand({
			DBInstanceIdentifier: 'healthylinkx-db'}));
		const endpoint = data.DBInstances[0].Endpoint.Address;

		// unzip the file to dump on the database
		const zip = new AdmZip('../data/healthylinkxdump.sql.zip');
		zip.extractAllTo('../data/', true);

        // Read the dump file
        //const dumpfile = await fs.readFile('./data/healthylinkxdump.sql', 'utf8');
        const dumpfile = fs.readFileSync('../data/healthylinkxdump.sql', {
            encoding: 'utf8'
        });
		console.log("Data ready for import.");
		
        // Create connection
        const connection = await mysql.createConnection({
            host: endpoint,
            user: DBUSER,
            password: DBPWD,
            database: "healthylinkx",
            multipleStatements: true // Important for executing multiple SQL statements
		});
		
		//cleanup the database
		// we do this separately to avoid locks and better error control
		await connection.query({ sql: 'DROP TABLE IF EXISTS `npidata2`;', timeout: 90000});
		await connection.query({ sql: 'DROP TABLE IF EXISTS `transactions`;', timeout: 90000});
		await connection.query({ sql: 'DROP TABLE IF EXISTS `taxonomy`;', timeout: 90000});
		await connection.query({ sql: 'DROP TABLE IF EXISTS `speciality`;', timeout: 90000});
		console.log("Datastore ready for import.");

		//Load data
		await connection.query({ sql: dumpfile, timeout: 180000});

       // Close the connection
        await connection.end();

		//cleanup. delete the unzipped file
		await fs.unlinkSync('../data/healthylinkxdump.sql');

		console.log("Success. healthylinkx-db populated with data.");
	} catch (err) {
		console.log("Error loading datastore: ", err);
	}
}

async function DSCreate() {
	try {
		// Create an RDS client service object
		const rdsclient = new RDSClient({});

		//if the datastore already exist nothing to do
		try {
			data = await rdsclient.send(new DescribeDBInstancesCommand({
				DBInstanceIdentifier: 'healthylinkx-db'}));
			if (data.DBInstances[0].DBInstanceStatus  === 'available') {
				console.log("healthylinkx-db already exists.");
				return;
			}
		} catch (err) {
			console.log("Datastore doesn't exist, creating one.");
		}

		//In order to have public access to the DB
		//we need to create a security group (aka firewall)with an inbound rule 
		//protocol:TCP, Port:3306, Source: Anywhere (0.0.0.0/0)
		const ec2client = new EC2Client({});
		
		var data = await ec2client.send(new CreateSecurityGroupCommand({ Description: 'MySQL Sec Group', GroupName: 'DBSecGroup'}));
		const vpcSecurityGroupId = data.GroupId;
		console.log("Success. " + vpcSecurityGroupId + " created.");
		
		const paramsIngress = {
			GroupId: data.GroupId,
			IpPermissions: [{
				IpProtocol: "tcp",
				FromPort: 3306,
				ToPort: 3306,
				IpRanges: [{ CidrIp: "0.0.0.0/0" }],
			}],
		};
		await ec2client.send( new AuthorizeSecurityGroupIngressCommand(paramsIngress));
		console.log("Success. " + vpcSecurityGroupId + " authorized.");
	
		// Create the RDS instance
		var rdsparams = {
			AllocatedStorage: 20, 
			BackupRetentionPeriod: 0,
			DBInstanceClass: 'db.t3.micro',
			DBInstanceIdentifier: 'healthylinkx-db',
			DBName: 'healthylinkx',
			Engine: 'mysql',
			MasterUsername: DBUSER,
			MasterUserPassword: DBPWD,
			PubliclyAccessible: true,
			VpcSecurityGroupIds: [vpcSecurityGroupId]
		};
		await rdsclient.send(new CreateDBInstanceCommand(rdsparams));
		console.log("Success. healthylinkx-db requested.");

		//wait till the instance is created
		while(true) {
			data = await rdsclient.send(new DescribeDBInstancesCommand({DBInstanceIdentifier: 'healthylinkx-db'}));
			if (data.DBInstances[0].DBInstanceStatus  === 'available') break;
			console.log("Waiting. healthylinkx-db " + data.DBInstances[0].DBInstanceStatus);
			await sleep(30);
		}
		console.log("Success. healthylinkx-db provisioned.");
	} catch (err) {
		console.log("Error creating datastore: ", err);
	}
}

async function main () {
	await DSCreate();
	await LoadData();
}

main();
