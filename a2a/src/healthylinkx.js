import {
	RDSClient,
	DescribeDBInstancesCommand
} from "@aws-sdk/client-rds";

import mysql from 'mysql2/promise';
import * as fs from 'fs'; 
import * as path from 'path';
import { fileURLToPath } from 'url';

// Read the config file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configPath = path.join(__dirname, 'config.json');
const rawConfig = fs.readFileSync(configPath);
const config = JSON.parse(rawConfig);

// Extract configurations
const DBUSER = config.datastore.user;
const DBPWD = config.datastore.passwd;

function ServerReply (code, message){
    return {
        statusCode: code,
        result: message
    };
}

export async function SearchDoctors(gender, lastname, specialty, zipcode){
 	//check params
 	if(!zipcode && !lastname && !specialty)
		return ServerReply (204, "Not enought params!");

    //normalize gender
	if (gender){
		if (gender === 'male') gender = 'M';
		if (gender === 'm') gender = 'M';
		if (gender !== 'M') gender = 'F';
	}

    // build the query to the datastore
	var query = "SELECT Provider_Full_Name,Provider_Full_Street,Provider_Full_City,Classification FROM npidata2 WHERE (";
    if(lastname)
        query += "(Provider_Last_Name_Legal_Name = '" + lastname + "')";
    if(gender){
        if(lastname) query += " AND ";
        query += "(Provider_Gender_Code = '" + gender + "')";
    }
    if(specialty){
        if(lastname || gender) query += " AND ";
        query += "(Classification = '" + specialty + "')";
    }
    if(zipcode){
        if(lastname || gender || specialty) query += " AND ";
        query += "(Provider_Short_Postal_Code = '" + zipcode + "')";
    }
    query += ") limit 25";
    
    // query the datastore and return results
    try {        
        //URL of the datastore
        const rdsclient = new RDSClient({});
        const data = await rdsclient.send(new DescribeDBInstancesCommand({
            DBInstanceIdentifier: "healthylinkx-db"}));
        const endpoint = data.DBInstances[0].Endpoint.Address;
        
        const connection = await mysql.createConnection({
            host: endpoint,
            user: DBUSER,
            password: DBPWD,
            database: "healthylinkx"
        });
        await connection.connect();

        const [rows,fields] = await connection.query({ sql: query, timeout: 10000});
        await connection.end();

        return ServerReply (200, rows);
    } catch(err) {
        return ServerReply (500, ("Error accessing to the datastore with query: " + query + " and error: " + err));
    } 
}

// use this search for locally testing the functionality of the MCP Server
export async function SearchDoctorsTest(gender, lastname, specialty, zipcode){
    return ServerReply (200, [
        { Provider_Full_Name: "John Doe",   Provider_Full_Street: "Main Street 1", Provider_Full_City: "Redmond", Classification: "Surgeon"},
        { Provider_Full_Name: "John Smith", Provider_Full_Street: "Main Street 2", Provider_Full_City: "Redmond", Classification: "Surgeon"},
        { Provider_Full_Name: "John Brown", Provider_Full_Street: "Main Street 3", Provider_Full_City: "Redmond", Classification: "Surgeon"}
    ]);
}
