#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { Ec2AssignmentStack } from '../lib/ec2-assignment-stack';

// Groupname. Set to a name such as "karl-jansson" after one of the users in the group
const GROUP_NAME = "john-farell";

const AWS_ACCOUNT_ID = "292370674225";

// if (GROUP_NAME === "UNSET") {
//   throw new Error("You must set the GROUP_NAME variable in S3BucketApp");
// }

const app = new cdk.App();
new Ec2AssignmentStack(app, GROUP_NAME + "-ec2-assignment", {
  env: {
    account: AWS_ACCOUNT_ID,
    region: 'eu-north-1'
  },


});
app.synth();