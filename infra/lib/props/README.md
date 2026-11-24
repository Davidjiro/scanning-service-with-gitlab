# lib/props/  -  the contracts

A **props interface** lists every input a construct needs. It is the construct's public API.

```
config/network.config.ts  returns a  VpcNetworkProps  ──►  new VpcNetwork(this, 'AppVpc', props)
```

Why separate files?
- **Readability**: open one file to see everything configurable about networking.
- **Testability**: you can construct a construct with hand-written props in a unit test.
- **Decoupling**: constructs never import `config/`, so they are reusable in other projects.
- **Review**: a change to an interface is a visible, deliberate API change.

| File | Interfaces |
|------|------------|
| `network-props.ts` | `VpcNetworkProps`, `SubnetLayoutProps`, `VpcPeeringProps`, `TransitGatewayHubProps`, `PrivateHostedZoneProps`, `ClientHostProps` |
| `data-props.ts` | `DynamoTableProps`, `SecureBucketProps`, `QueueWithDlqProps`, `EventTopicProps` |
| `compute-props.ts` | `PythonLambdaProps`, `LambdaRestApiProps`, `OrderStateMachineProps`, `FargateAlbServiceProps`, `EksClusterProps`, `LatticeNetworkProps` |
| `gitlab-props.ts` | `GitlabAccessProps` |

## Conventions
- All fields are `readonly`.
- Plain values (numbers, strings, `cdk.Duration`) come from **config**. Live objects (`ec2.IVpc`, `dynamodb.ITable`)
  are added by the **stack**, because they only exist after another construct was created.
  That is why config functions often return `Omit<XProps, 'vpc' | 'environment'>`.
- Every field has a doc comment that says what happens if you change it.
