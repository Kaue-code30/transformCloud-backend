const { writeFileSync } = require('node:fs');
const { join } = require('node:path');

const providers = {
  AWS: {
    region: 'sa-east-1',
    items: [
      ['AmazonEC2', 'Amazon EC2', 'COMPUTE_VM', 'm7g.2xlarge', 'aws-sku-m7g-2xlarge', 'aws-meter-m7g-2xlarge', 'Hrs', 1.2, 8, 32, 'Linux', 'arm64', null],
      ['AmazonRDS', 'Amazon RDS PostgreSQL', 'MANAGED_POSTGRES', 'db.r6g.large', 'aws-sku-rds-db-r6g-large', 'aws-meter-rds-db-r6g-large', 'Hrs', 1.125, 2, 16, 'Linux', 'arm64', 'PostgreSQL'],
      ['AmazonS3', 'Amazon S3 Standard', 'OBJECT_STORAGE', 'S3-Standard', 'aws-sku-s3-standard-storage', 'aws-meter-s3-standard-storage', 'GB-Mo', 0.08],
      ['AWSLambda', 'AWS Lambda', 'SERVERLESS_FUNCTION', 'Lambda-GB-Second', 'aws-sku-lambda-gb-second', 'aws-meter-lambda-gb-second', 'GB-Second', 0.000208333],
      ['AmazonCloudWatch', 'Amazon CloudWatch Logs', 'OBSERVABILITY_LOGS', 'CloudWatch-Logs-Ingested', 'aws-sku-cloudwatch-logs', 'aws-meter-cloudwatch-logs', 'GB', 0.225],
      ['AWSDataTransfer', 'AWS Data Transfer', 'DATA_TRANSFER', 'DataTransfer-Out', 'aws-sku-data-transfer-out', 'aws-meter-data-transfer-out', 'GB', 0.14],
    ],
  },
  GCP: {
    region: 'southamerica-east1',
    items: [
      ['compute.googleapis.com', 'Compute Engine', 'COMPUTE_VM', 't2a-standard-8', 'gcp-sku-t2a-standard-8', 'gcp-meter-t2a-standard-8', 'Hrs', 0.75, 8, 32, 'Linux', 'arm64', null],
      ['sqladmin.googleapis.com', 'Cloud SQL for PostgreSQL', 'MANAGED_POSTGRES', 'db-custom-2-16384', 'gcp-sku-cloudsql-pg-2-16', 'gcp-meter-cloudsql-pg-2-16', 'Hrs', 0.82, 2, 16, 'Linux', 'arm64', 'PostgreSQL'],
      ['storage.googleapis.com', 'Cloud Storage Standard', 'OBJECT_STORAGE', 'Standard-Regional', 'gcp-sku-storage-standard', 'gcp-meter-storage-standard', 'GB-Mo', 0.026],
      ['cloudfunctions.googleapis.com', 'Cloud Functions', 'SERVERLESS_FUNCTION', 'Functions-GB-Second', 'gcp-sku-functions-gb-second', 'gcp-meter-functions-gb-second', 'GB-Second', 0.000018],
      ['logging.googleapis.com', 'Cloud Logging', 'OBSERVABILITY_LOGS', 'Logging-Data-Ingestion', 'gcp-sku-logging-ingestion', 'gcp-meter-logging-ingestion', 'GB', 0.5],
      ['networking.googleapis.com', 'Cloud Network Egress', 'DATA_TRANSFER', 'Internet-Egress', 'gcp-sku-network-egress', 'gcp-meter-network-egress', 'GB', 0.12],
    ],
  },
  AZURE: {
    region: 'brazilsouth',
    items: [
      ['Microsoft.Compute/virtualMachines', 'Virtual Machines', 'COMPUTE_VM', 'Standard_D8ps_v5', 'azure-sku-standard-d8ps-v5', 'azure-meter-standard-d8ps-v5', 'Hrs', 0.85, 8, 32, 'Linux', 'arm64', null],
      ['Microsoft.DBforPostgreSQL/flexibleServers', 'Azure Database for PostgreSQL', 'MANAGED_POSTGRES', 'Standard_D2ds_v5', 'azure-sku-postgres-d2ds-v5', 'azure-meter-postgres-d2ds-v5', 'Hrs', 0.95, 2, 16, 'Linux', 'arm64', 'PostgreSQL'],
      ['Microsoft.Storage/storageAccounts', 'Azure Blob Storage Hot LRS', 'OBJECT_STORAGE', 'Blob-Hot-LRS', 'azure-sku-blob-hot-lrs', 'azure-meter-blob-hot-lrs', 'GB-Mo', 0.022],
      ['Microsoft.Web/functions', 'Azure Functions', 'SERVERLESS_FUNCTION', 'Functions-GB-Second', 'azure-sku-functions-gb-second', 'azure-meter-functions-gb-second', 'GB-Second', 0.000016],
      ['Microsoft.OperationalInsights/workspaces', 'Azure Monitor Logs', 'OBSERVABILITY_LOGS', 'Logs-Data-Ingestion', 'azure-sku-monitor-logs', 'azure-meter-monitor-logs', 'GB', 2.76],
      ['Microsoft.Network/bandwidth', 'Azure Bandwidth', 'DATA_TRANSFER', 'Internet-Egress', 'azure-sku-bandwidth-egress', 'azure-meter-bandwidth-egress', 'GB', 0.12],
    ],
  },
  OCI: {
    region: 'sa-saopaulo-1',
    items: [
      ['Compute', 'OCI Compute', 'COMPUTE_VM', 'VM.Standard.A1.Flex-8-32', 'oci-sku-a1-flex-8-32', 'oci-meter-a1-flex-8-32', 'Hrs', 0.7, 8, 32, 'Linux', 'arm64', null],
      ['Postgresql', 'OCI Database with PostgreSQL', 'MANAGED_POSTGRES', 'PostgreSQL-2-16', 'oci-sku-postgresql-2-16', 'oci-meter-postgresql-2-16', 'Hrs', 0.65, 2, 16, 'Linux', 'arm64', 'PostgreSQL'],
      ['ObjectStorage', 'OCI Object Storage Standard', 'OBJECT_STORAGE', 'Object-Storage-Standard', 'oci-sku-object-standard', 'oci-meter-object-standard', 'GB-Mo', 0.0255],
      ['Functions', 'OCI Functions', 'SERVERLESS_FUNCTION', 'Functions-GB-Second', 'oci-sku-functions-gb-second', 'oci-meter-functions-gb-second', 'GB-Second', 0.00001417],
      ['Logging', 'OCI Logging', 'OBSERVABILITY_LOGS', 'Logging-Data-Ingestion', 'oci-sku-logging-ingestion', 'oci-meter-logging-ingestion', 'GB', 0.05],
      ['DataTransfer', 'OCI Data Transfer', 'DATA_TRANSFER', 'Internet-Egress', 'oci-sku-data-transfer-egress', 'oci-meter-data-transfer-egress', 'GB', 0.0085],
    ],
  },
};

for (const [provider, config] of Object.entries(providers)) {
  const services = [];
  const offerings = [];
  const meters = [];
  const offeringMeters = [];
  for (const item of config.items) {
    const [code, name, resourceKind, sku, nativeSkuId, nativeMeterId, unit, rate, vcpu, memoryGiB, operatingSystem, architecture, engine] = item;
    const offeringKey = `TEST:${provider}:OFFERING:${code}:${config.region}:${sku}`;
    const meterKey = `TEST:${provider}:METER:${code}:${config.region}:${sku}`;
    services.push({ nativeCode: code, name, resourceKind });
    offerings.push({
      sourceKey: offeringKey,
      serviceNativeCode: code,
      nativeProductId: nativeSkuId,
      nativeSkuName: sku,
      displayName: `${name} ${sku} (fixture)`,
      region: config.region,
      purchaseOption: 'ON_DEMAND',
      ...(operatingSystem ? { operatingSystem } : {}),
      ...(architecture ? { architecture } : {}),
      ...(engine ? { engine } : {}),
      ...(vcpu ? { vcpu } : {}),
      ...(memoryGiB ? { memoryGiB } : {}),
      attributes: { fixture: true, resourceKind },
      rawSource: { fixture: true },
    });
    meters.push({
      sourceKey: meterKey,
      serviceNativeCode: code,
      nativeSkuId,
      nativeMeterId,
      name: `${name} ${unit} (fixture)`,
      region: config.region,
      pricingUnit: unit,
      unitMultiplier: 1,
      currency: 'USD',
      priceType: 'ON_DEMAND',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      attributes: { fixture: true },
      rawSource: { fixture: true },
      tiers: [{ startQuantity: 0, unitPrice: rate }],
    });
    offeringMeters.push({ offeringSourceKey: offeringKey, meterSourceKey: meterKey, quantity: 1 });
  }
  const snapshot = {
    provider,
    source: 'TEST_FIXTURE_ONLY',
    version: 'multiservice-demo-2026-09-25',
    mode: 'PARTIAL',
    services,
    offerings,
    meters,
    offeringMeters,
  };
  writeFileSync(
    join(__dirname, `${provider.toLowerCase()}-multiservice-demo.json`),
    `${JSON.stringify(snapshot, null, 2)}\n`,
    'utf8',
  );
}
