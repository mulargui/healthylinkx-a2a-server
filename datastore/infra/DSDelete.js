
import {
	RDSClient,
	DeleteDBInstanceCommand,
	DescribeDBInstancesCommand
} from "@aws-sdk/client-rds";
import {
	EC2Client,
	DescribeSecurityGroupsCommand,
	DeleteSecurityGroupCommand
} from "@aws-sdk/client-ec2";

// ======== helper function ============
function sleep(secs) {
	return new Promise(resolve => setTimeout(resolve, secs * 1000));
}

// ====== create MySQL database and add data =====
async function DSDelete() {

	try {
		// Delete the RDS instance
		const rdsclient = new RDSClient({});
		var rdsparams = {
			DBInstanceIdentifier: 'healthylinkx-db',
			SkipFinalSnapshot: true,
			DeleteAutomatedBackups: true
		};
		await rdsclient.send(new DeleteDBInstanceCommand(rdsparams));
		console.log("Success. healthylinkx-db deletion requested.");

		//wait till the instance is deleted
		while(true) {
			try {
				await sleep(30);
				const data = await rdsclient.send(new DescribeDBInstancesCommand({DBInstanceIdentifier: 'healthylinkx-db'}));
				console.log("Waiting. healthylinkx-db " + data.DBInstances[0].DBInstanceStatus);
			} catch (err) {
				break;
			}
		}
		console.log("Success. healthylinkx-db deleted.");
	
		//delete the security group
		const ec2client = new EC2Client({});
		const data = await ec2client.send(new DescribeSecurityGroupsCommand({GroupNames: ['DBSecGroup']}));
		await ec2client.send(new DeleteSecurityGroupCommand({GroupId: data.SecurityGroups[0].GroupId }));
		console.log("Success. " + data.SecurityGroups[0].GroupId + " deleted.");		

	} catch (err) {
		console.log("Error deleting datastore: ", err);
	}
}

DSDelete();
