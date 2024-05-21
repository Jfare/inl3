import * as cdk from 'aws-cdk-lib';
import { Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { IHostedZone } from 'aws-cdk-lib/aws-route53';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { ManagedPolicy } from 'aws-cdk-lib/aws-iam';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import { aws_route53 as route53 } from 'aws-cdk-lib';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as rds from 'aws-cdk-lib/aws-rds';

export class Ec2AssignmentStack extends Stack {
  private readonly hostedZone: IHostedZone;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'HaHostedZone', {
      hostedZoneId: 'Z0413857YT73A0A8FRFF',
      zoneName: 'cloud-ha.com',
    });

    const vpc = ec2.Vpc.fromLookup(this, "MyVpc", {
      isDefault: true,
      region: "eu-north-1"
      
    });


    const databaseCredentialsSecret = new rds.DatabaseSecret(this, 'DatabaseCredentialsSecret', {
      username: 'master',
    });

    // const monitoringRole = new iam.Role(this, 'RDSMonitoringRole', {
    //   assumedBy: new iam.ServicePrincipal('monitoring.rds.amazonaws.com'),
    //   managedPolicies: [
    //     ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonRDSEnhancedMonitoringRole"),
    //     ManagedPolicy.fromAwsManagedPolicyName("AmazonRDSCloudWatchLogsRole")
    //   ]
    // });
    const role = new iam.Role(this, 'EC2Role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"),
        ManagedPolicy.fromAwsManagedPolicyName("AmazonEC2ContainerRegistryReadOnly"),
        ManagedPolicy.fromAwsManagedPolicyName("AmazonRDSFullAccess")
      ]
    });


    databaseCredentialsSecret.grantRead(role);

    const database = new rds.DatabaseInstance(this, 'Database', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16_2 }),
      credentials: rds.Credentials.fromSecret(databaseCredentialsSecret),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      allocatedStorage: 20,
      multiAz: false,
      storageType: rds.StorageType.GP2,
      deletionProtection: false,
      cloudwatchLogsExports: ['postgresql'] // Enable log exports
    });

    // Skapar userData för ec2 instans.
    const userData = ec2.UserData.forLinux();

    userData.addCommands(
      `yum install docker -y`,
      `sudo yum install jq -y`,
      `sudo systemctl start docker`,
      `aws ecr get-login-password --region eu-north-1 | docker login --username AWS --password-stdin 292370674225.dkr.ecr.eu-north-1.amazonaws.com`,
      `DB_PASSWORD=$(aws secretsmanager get-secret-value --secret-id '${databaseCredentialsSecret.secretArn}' --query SecretString --output text --region eu-north-1 | jq -r .password)`,
      `docker run -d -e DB_URL='${database.dbInstanceEndpointAddress}' -e DB_USERNAME='master' -e DB_PASSWORD=$DB_PASSWORD -e SPRING_PROFILES_ACTIVE='postgres' --name my-application -p 80:8080 292370674225.dkr.ecr.eu-north-1.amazonaws.com/webshop-api:latest`,
    );

    const ec2SecurityGroup = new ec2.SecurityGroup(this, 'EC2SecurityGroup', {
      vpc,
      description: 'Security group for EC2 instances',
      allowAllOutbound: true
    });

    const lbSecurityGroup = new ec2.SecurityGroup(this, 'LoadBalancerSecurityGroup', {
      vpc,
      description: 'Security group for the load balancer',
      allowAllOutbound: true
    });

    const lb = new elbv2.ApplicationLoadBalancer(this, 'LB', {
      vpc,
      internetFacing: true,
      securityGroup: lbSecurityGroup
    });

    // const databaseSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
    //   vpc,
    //   description: 'Security group for RDS database',
    //   allowAllOutbound: true // Allows all outbound traffic
    // });
    
    database.connections.allowFrom(ec2SecurityGroup, ec2.Port.tcp(5432), 'Allow inbound traffic from EC2 instances');
    ec2SecurityGroup.addIngressRule(lbSecurityGroup, ec2.Port.tcp(80), 'Allow inbound HTTP traffic from load balancer');


    //Update policy för att säkerställa att vår asg ersätts vid varje uppdatering.
    const updatePolicy = autoscaling.UpdatePolicy.replacingUpdate();

    const asg = new autoscaling.AutoScalingGroup(this, 'ASG', {
      vpc,
      securityGroup: ec2SecurityGroup,
      role,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE3, ec2.InstanceSize.MICRO),
      machineImage: new ec2.AmazonLinuxImage({
        generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
        cpuType: ec2.AmazonLinuxCpuType.X86_64
      }),
      userData: userData,
      minCapacity: 1,
      maxCapacity: 5,
      updatePolicy: updatePolicy
    });

    const recordSet = new route53.RecordSet(this, 'MyRecordSet', {
      recordType: route53.RecordType.A,
      target: route53.RecordTarget.fromAlias(new route53Targets.LoadBalancerTarget(lb)),
      zone: hostedZone,
      comment: 'JohnAlexandraRoute53',
      deleteExisting: false,
      recordName: 'john-farell-api.cloud-ha.com',
      region: 'eu-north-1',
    });

    const listener = lb.addListener('Listener', {
      port: 80,
      open: true,
    });

    listener.addTargets('ApplicationFleet', {
      port: 80,
      targets: [asg]
    });
  }
}
// Skapa en ny EC2-instans
// const instance = new ec2.Instance(this, 'JohnAlexandraEC2Instance', {
//   vpc,
//   securityGroup,
//   role,
//   vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
//   instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE3, ec2.InstanceSize.MICRO),
//   machineImage: new ec2.AmazonLinuxImage({
//     generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
//     cpuType: ec2.AmazonLinuxCpuType.X86_64
//   }),
//   userData: userData
// });