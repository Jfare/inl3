import * as cdk from 'aws-cdk-lib';
import { Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { HostedZone, IHostedZone, HostedZoneAttributes } from 'aws-cdk-lib/aws-route53';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { ManagedPolicy } from 'aws-cdk-lib/aws-iam';

export class Ec2AssignmentStack extends Stack {
  private readonly hostedZone: IHostedZone;


  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, 'MyVPC');
    // Security group skapad
    const securityGroup = new ec2.SecurityGroup(this, 'JohnAlexandraSecurityGroup', {
      vpc,
      description: 'JohnAlexandra-ec2-assignment/SecurityGroup',
      allowAllOutbound: true  // Tillåter all utgående trafik
    });

    // IAM Role skapad
    const role = new iam.Role(this, 'EC2Role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"),
        ManagedPolicy.fromAwsManagedPolicyName("AmazonEC2ContainerRegistryReadOnly")
      ]
    });

    // Skapa en ny EC2-instans
    const instance = new ec2.Instance(this, 'JohnAlexandraEC2Instance', {
      vpc,
      securityGroup,
      role,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE3, ec2.InstanceSize.MICRO),
      machineImage: new ec2.AmazonLinuxImage({
        generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
        cpuType: ec2.AmazonLinuxCpuType.X86_64
      }),
    });

  }
}
