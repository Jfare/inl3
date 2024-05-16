import * as cdk from 'aws-cdk-lib';
import { Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { IHostedZone } from 'aws-cdk-lib/aws-route53';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { ManagedPolicy } from 'aws-cdk-lib/aws-iam';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2'
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import { aws_route53 as route53 } from 'aws-cdk-lib';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';


export class Ec2AssignmentStack extends Stack {
  private readonly hostedZone: IHostedZone;


  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const userData = ec2.UserData.forLinux();

    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'HaHostedZone', {
      hostedZoneId: 'Z0413857YT73A0A8FRFF',
      zoneName: 'cloud-ha.com',
    });

    // Vpc skapad
    const vpc = new ec2.Vpc(this, 'MyVPC');

    const databaseCredentialsSecret = new rds.DatabaseSecret(this, 'DatabaseCredentialsSecret', {
      username: 'master',
    },);

    const database = new rds.DatabaseInstance(this, 'Database', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_13 }),
      credentials: rds.Credentials.fromSecret(databaseCredentialsSecret), // Använd hemligheten du just skapade
      vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      allocatedStorage: 20,
      multiAz: false,
      storageType: rds.StorageType.GP2,
      deletionProtection: false,
    });

    // Add userdata for ec2 instance
    userData.addCommands(
      "yum install docker -y",
      "sudo systemctl start docker",
      "aws ecr get-login-password --region eu-north-1 | docker login --username AWS --password-stdin 292370674225.dkr.ecr.eu-north-1.amazonaws.com",
      `docker run -d -e DB_URL='my-postgres-url.eu-north-1.rds.amazonaws.com'`,
      `-e DB_USERNAME='master' -e DB_PASSWORD='mastermaster'`,
      "-e SPRING_PROFILES_ACTIVE='postgres' --name my-application -p 80:8080 292370674225.dkr.ecr.eu-north-1.amazonaws.com/webshop-api:latest"
    );


    // Security group skapad
    const securityGroup = new ec2.SecurityGroup(this, 'JohnAlexandraSecurityGroup', {
      vpc,
      description: 'JohnAlexandra-ec2-assignment/SecurityGroup',
      allowAllOutbound: true  // Tillåter all utgående trafik
    });

    const lbSecurityGroup = new ec2.SecurityGroup(this, 'LoadBalancerSecurityGroup', {
      vpc,
      description: 'Security group for the load balancer',
      allowAllOutbound: true
    });

    // Load balancer skapad
    const lb = new elbv2.ApplicationLoadBalancer(this, 'LB', {
      vpc,
      internetFacing: true,
      securityGroup: lbSecurityGroup
    });

    // Skapa en säkerhetsgrupp för din RDS-instans
    const databaseSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
      vpc,
      description: 'Security group for RDS database',
    });

    // Tillåt inkommande trafik från din EC2-säkerhetsgrupp
    databaseSecurityGroup.addIngressRule(securityGroup, ec2.Port.tcp(5432), 'Allow inbound traffic from EC2 security group');


    securityGroup.addIngressRule(lbSecurityGroup, ec2.Port.tcp(80), 'Allow inbound HTTP traffic from load balancer');

    // IAM Role skapad
    const role = new iam.Role(this, 'EC2Role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"),
        ManagedPolicy.fromAwsManagedPolicyName("AmazonEC2ContainerRegistryReadOnly")
      ]
    });

    // Skapa en AutoScaling-grupp
    const asg = new autoscaling.AutoScalingGroup(this, 'ASG', {
      vpc,
      securityGroup,
      role,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE3, ec2.InstanceSize.MICRO),
      machineImage: new ec2.AmazonLinuxImage({
        generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
        cpuType: ec2.AmazonLinuxCpuType.X86_64
      }),
      userData: userData,
      minCapacity: 1,  // minimiantal instanser i gruppen
      maxCapacity: 5,  // maximiantal instanser i gruppen
    });



    const recordSet = new route53.RecordSet(this, 'MyRecordSet', {
      recordType: route53.RecordType.A,
      target: route53.RecordTarget.fromAlias(new route53Targets.LoadBalancerTarget(lb)),
      zone: hostedZone,

      // the properties below are optional
      comment: 'JohnAlexandraRoute53',
      deleteExisting: false,
      recordName: 'john-farell-api.cloud-ha.com',
      region: 'eu-north-1',
    });


    // Listener för HTTP trafik
    const listener = lb.addListener('Listener', {
      port: 80,
      open: true,
    });



    listener.addTargets('ApplicationFleet', {
      port: 80,
      targets: [asg]
    }
    );


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