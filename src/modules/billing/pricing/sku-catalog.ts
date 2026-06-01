/**
 * Catálogo estático de SKUs equivalentes entre provedores.
 *
 * Cobre os ~50 tipos de instância/serviço mais comuns em bills reais.
 * Quando um serviço é encontrado aqui, o mapeamento é direto (sem Claude),
 * eliminando o risco de nome inventado.
 *
 * Estrutura: chave = instanceType AWS normalizado (lowercase)
 */

export interface StaticSkuEntry {
  awsService: string;
  awsInstanceType: string;
  gcp: { service: string; machineType: string };
  azure: { service: string; skuName: string; sku: string };
  oci: { service: string; shape: string; ocpu: number; memoryGb: number };
}

// ─── Compute (EC2) ────────────────────────────────────────────────────────────

const EC2_MAPPINGS: StaticSkuEntry[] = [
  // General purpose — M7g (Graviton3)
  { awsService: 'AmazonEC2', awsInstanceType: 'm7g.medium',    gcp: { service: 'Compute Engine', machineType: 'n2-standard-2'  }, azure: { service: 'Virtual Machines', skuName: 'Standard_D2s_v5',  sku: 'Standard_D2s_v5'  }, oci: { service: 'Compute', shape: 'VM.Standard.E4.Flex', ocpu: 1,  memoryGb: 4   } },
  { awsService: 'AmazonEC2', awsInstanceType: 'm7g.large',     gcp: { service: 'Compute Engine', machineType: 'n2-standard-2'  }, azure: { service: 'Virtual Machines', skuName: 'Standard_D2s_v5',  sku: 'Standard_D2s_v5'  }, oci: { service: 'Compute', shape: 'VM.Standard.E4.Flex', ocpu: 1,  memoryGb: 8   } },
  { awsService: 'AmazonEC2', awsInstanceType: 'm7g.xlarge',    gcp: { service: 'Compute Engine', machineType: 'n2-standard-4'  }, azure: { service: 'Virtual Machines', skuName: 'Standard_D4s_v5',  sku: 'Standard_D4s_v5'  }, oci: { service: 'Compute', shape: 'VM.Standard.E4.Flex', ocpu: 2,  memoryGb: 16  } },
  { awsService: 'AmazonEC2', awsInstanceType: 'm7g.2xlarge',   gcp: { service: 'Compute Engine', machineType: 'n2-standard-8'  }, azure: { service: 'Virtual Machines', skuName: 'Standard_D8s_v5',  sku: 'Standard_D8s_v5'  }, oci: { service: 'Compute', shape: 'VM.Standard.E4.Flex', ocpu: 4,  memoryGb: 32  } },
  { awsService: 'AmazonEC2', awsInstanceType: 'm7g.4xlarge',   gcp: { service: 'Compute Engine', machineType: 'n2-standard-16' }, azure: { service: 'Virtual Machines', skuName: 'Standard_D16s_v5', sku: 'Standard_D16s_v5' }, oci: { service: 'Compute', shape: 'VM.Standard.E4.Flex', ocpu: 8,  memoryGb: 64  } },
  { awsService: 'AmazonEC2', awsInstanceType: 'm7g.8xlarge',   gcp: { service: 'Compute Engine', machineType: 'n2-standard-32' }, azure: { service: 'Virtual Machines', skuName: 'Standard_D32s_v5', sku: 'Standard_D32s_v5' }, oci: { service: 'Compute', shape: 'VM.Standard.E4.Flex', ocpu: 16, memoryGb: 128 } },
  { awsService: 'AmazonEC2', awsInstanceType: 'm7g.16xlarge',  gcp: { service: 'Compute Engine', machineType: 'n2-standard-64' }, azure: { service: 'Virtual Machines', skuName: 'Standard_D64s_v5', sku: 'Standard_D64s_v5' }, oci: { service: 'Compute', shape: 'VM.Standard.E4.Flex', ocpu: 32, memoryGb: 256 } },

  // General purpose — M6i (Intel)
  { awsService: 'AmazonEC2', awsInstanceType: 'm6i.large',     gcp: { service: 'Compute Engine', machineType: 'n2-standard-2'  }, azure: { service: 'Virtual Machines', skuName: 'Standard_D2s_v5',  sku: 'Standard_D2s_v5'  }, oci: { service: 'Compute', shape: 'VM.Standard3.Flex',  ocpu: 1,  memoryGb: 8   } },
  { awsService: 'AmazonEC2', awsInstanceType: 'm6i.xlarge',    gcp: { service: 'Compute Engine', machineType: 'n2-standard-4'  }, azure: { service: 'Virtual Machines', skuName: 'Standard_D4s_v5',  sku: 'Standard_D4s_v5'  }, oci: { service: 'Compute', shape: 'VM.Standard3.Flex',  ocpu: 2,  memoryGb: 16  } },
  { awsService: 'AmazonEC2', awsInstanceType: 'm6i.2xlarge',   gcp: { service: 'Compute Engine', machineType: 'n2-standard-8'  }, azure: { service: 'Virtual Machines', skuName: 'Standard_D8s_v5',  sku: 'Standard_D8s_v5'  }, oci: { service: 'Compute', shape: 'VM.Standard3.Flex',  ocpu: 4,  memoryGb: 32  } },
  { awsService: 'AmazonEC2', awsInstanceType: 'm6i.4xlarge',   gcp: { service: 'Compute Engine', machineType: 'n2-standard-16' }, azure: { service: 'Virtual Machines', skuName: 'Standard_D16s_v5', sku: 'Standard_D16s_v5' }, oci: { service: 'Compute', shape: 'VM.Standard3.Flex',  ocpu: 8,  memoryGb: 64  } },
  { awsService: 'AmazonEC2', awsInstanceType: 'm6i.8xlarge',   gcp: { service: 'Compute Engine', machineType: 'n2-standard-32' }, azure: { service: 'Virtual Machines', skuName: 'Standard_D32s_v5', sku: 'Standard_D32s_v5' }, oci: { service: 'Compute', shape: 'VM.Standard3.Flex',  ocpu: 16, memoryGb: 128 } },

  // Compute optimized — C7g (Graviton3)
  { awsService: 'AmazonEC2', awsInstanceType: 'c7g.medium',    gcp: { service: 'Compute Engine', machineType: 'c2-standard-4'  }, azure: { service: 'Virtual Machines', skuName: 'Standard_F2s_v2',  sku: 'Standard_F2s_v2'  }, oci: { service: 'Compute', shape: 'VM.Optimized3.Flex',  ocpu: 1,  memoryGb: 2   } },
  { awsService: 'AmazonEC2', awsInstanceType: 'c7g.large',     gcp: { service: 'Compute Engine', machineType: 'c2-standard-4'  }, azure: { service: 'Virtual Machines', skuName: 'Standard_F4s_v2',  sku: 'Standard_F4s_v2'  }, oci: { service: 'Compute', shape: 'VM.Optimized3.Flex',  ocpu: 1,  memoryGb: 4   } },
  { awsService: 'AmazonEC2', awsInstanceType: 'c7g.xlarge',    gcp: { service: 'Compute Engine', machineType: 'c2-standard-4'  }, azure: { service: 'Virtual Machines', skuName: 'Standard_F8s_v2',  sku: 'Standard_F8s_v2'  }, oci: { service: 'Compute', shape: 'VM.Optimized3.Flex',  ocpu: 2,  memoryGb: 8   } },
  { awsService: 'AmazonEC2', awsInstanceType: 'c7g.2xlarge',   gcp: { service: 'Compute Engine', machineType: 'c2-standard-8'  }, azure: { service: 'Virtual Machines', skuName: 'Standard_F16s_v2', sku: 'Standard_F16s_v2' }, oci: { service: 'Compute', shape: 'VM.Optimized3.Flex',  ocpu: 4,  memoryGb: 16  } },
  { awsService: 'AmazonEC2', awsInstanceType: 'c7g.4xlarge',   gcp: { service: 'Compute Engine', machineType: 'c2-standard-16' }, azure: { service: 'Virtual Machines', skuName: 'Standard_F32s_v2', sku: 'Standard_F32s_v2' }, oci: { service: 'Compute', shape: 'VM.Optimized3.Flex',  ocpu: 8,  memoryGb: 32  } },
  { awsService: 'AmazonEC2', awsInstanceType: 'c7g.8xlarge',   gcp: { service: 'Compute Engine', machineType: 'c2-standard-30' }, azure: { service: 'Virtual Machines', skuName: 'Standard_F48s_v2', sku: 'Standard_F48s_v2' }, oci: { service: 'Compute', shape: 'VM.Optimized3.Flex',  ocpu: 16, memoryGb: 64  } },

  // Compute optimized — C6i (Intel)
  { awsService: 'AmazonEC2', awsInstanceType: 'c6i.large',     gcp: { service: 'Compute Engine', machineType: 'c2-standard-4'  }, azure: { service: 'Virtual Machines', skuName: 'Standard_F4s_v2',  sku: 'Standard_F4s_v2'  }, oci: { service: 'Compute', shape: 'VM.Optimized3.Flex',  ocpu: 1,  memoryGb: 4   } },
  { awsService: 'AmazonEC2', awsInstanceType: 'c6i.xlarge',    gcp: { service: 'Compute Engine', machineType: 'c2-standard-4'  }, azure: { service: 'Virtual Machines', skuName: 'Standard_F8s_v2',  sku: 'Standard_F8s_v2'  }, oci: { service: 'Compute', shape: 'VM.Optimized3.Flex',  ocpu: 2,  memoryGb: 8   } },
  { awsService: 'AmazonEC2', awsInstanceType: 'c6i.2xlarge',   gcp: { service: 'Compute Engine', machineType: 'c2-standard-8'  }, azure: { service: 'Virtual Machines', skuName: 'Standard_F16s_v2', sku: 'Standard_F16s_v2' }, oci: { service: 'Compute', shape: 'VM.Optimized3.Flex',  ocpu: 4,  memoryGb: 16  } },
  { awsService: 'AmazonEC2', awsInstanceType: 'c6i.4xlarge',   gcp: { service: 'Compute Engine', machineType: 'c2-standard-16' }, azure: { service: 'Virtual Machines', skuName: 'Standard_F32s_v2', sku: 'Standard_F32s_v2' }, oci: { service: 'Compute', shape: 'VM.Optimized3.Flex',  ocpu: 8,  memoryGb: 32  } },

  // Memory optimized — R7g (Graviton3)
  { awsService: 'AmazonEC2', awsInstanceType: 'r7g.large',     gcp: { service: 'Compute Engine', machineType: 'n2-highmem-4'   }, azure: { service: 'Virtual Machines', skuName: 'Standard_E4s_v5',  sku: 'Standard_E4s_v5'  }, oci: { service: 'Compute', shape: 'VM.Standard.E4.Flex', ocpu: 1,  memoryGb: 16  } },
  { awsService: 'AmazonEC2', awsInstanceType: 'r7g.xlarge',    gcp: { service: 'Compute Engine', machineType: 'n2-highmem-4'   }, azure: { service: 'Virtual Machines', skuName: 'Standard_E8s_v5',  sku: 'Standard_E8s_v5'  }, oci: { service: 'Compute', shape: 'VM.Standard.E4.Flex', ocpu: 2,  memoryGb: 32  } },
  { awsService: 'AmazonEC2', awsInstanceType: 'r7g.2xlarge',   gcp: { service: 'Compute Engine', machineType: 'n2-highmem-8'   }, azure: { service: 'Virtual Machines', skuName: 'Standard_E16s_v5', sku: 'Standard_E16s_v5' }, oci: { service: 'Compute', shape: 'VM.Standard.E4.Flex', ocpu: 4,  memoryGb: 64  } },
  { awsService: 'AmazonEC2', awsInstanceType: 'r7g.4xlarge',   gcp: { service: 'Compute Engine', machineType: 'n2-highmem-16'  }, azure: { service: 'Virtual Machines', skuName: 'Standard_E32s_v5', sku: 'Standard_E32s_v5' }, oci: { service: 'Compute', shape: 'VM.Standard.E4.Flex', ocpu: 8,  memoryGb: 128 } },
  { awsService: 'AmazonEC2', awsInstanceType: 'r7g.8xlarge',   gcp: { service: 'Compute Engine', machineType: 'n2-highmem-32'  }, azure: { service: 'Virtual Machines', skuName: 'Standard_E64s_v5', sku: 'Standard_E64s_v5' }, oci: { service: 'Compute', shape: 'VM.Standard.E4.Flex', ocpu: 16, memoryGb: 256 } },

  // Memory optimized — R6i (Intel)
  { awsService: 'AmazonEC2', awsInstanceType: 'r6i.large',     gcp: { service: 'Compute Engine', machineType: 'n2-highmem-4'   }, azure: { service: 'Virtual Machines', skuName: 'Standard_E4s_v5',  sku: 'Standard_E4s_v5'  }, oci: { service: 'Compute', shape: 'VM.Standard3.Flex',  ocpu: 1,  memoryGb: 16  } },
  { awsService: 'AmazonEC2', awsInstanceType: 'r6i.xlarge',    gcp: { service: 'Compute Engine', machineType: 'n2-highmem-4'   }, azure: { service: 'Virtual Machines', skuName: 'Standard_E8s_v5',  sku: 'Standard_E8s_v5'  }, oci: { service: 'Compute', shape: 'VM.Standard3.Flex',  ocpu: 2,  memoryGb: 32  } },
  { awsService: 'AmazonEC2', awsInstanceType: 'r6i.2xlarge',   gcp: { service: 'Compute Engine', machineType: 'n2-highmem-8'   }, azure: { service: 'Virtual Machines', skuName: 'Standard_E16s_v5', sku: 'Standard_E16s_v5' }, oci: { service: 'Compute', shape: 'VM.Standard3.Flex',  ocpu: 4,  memoryGb: 64  } },
  { awsService: 'AmazonEC2', awsInstanceType: 'r6i.4xlarge',   gcp: { service: 'Compute Engine', machineType: 'n2-highmem-16'  }, azure: { service: 'Virtual Machines', skuName: 'Standard_E32s_v5', sku: 'Standard_E32s_v5' }, oci: { service: 'Compute', shape: 'VM.Standard3.Flex',  ocpu: 8,  memoryGb: 128 } },
];

// ─── RDS ─────────────────────────────────────────────────────────────────────

const RDS_MAPPINGS: StaticSkuEntry[] = [
  // PostgreSQL / MySQL — db.t3
  { awsService: 'AmazonRDS', awsInstanceType: 'db.t3.micro',   gcp: { service: 'Cloud SQL', machineType: 'db-f1-micro'       }, azure: { service: 'Azure Database for PostgreSQL Flexible Server', skuName: 'Standard_B1ms',   sku: 'Standard_B1ms'   }, oci: { service: 'MySQL Database Service', shape: 'MySQL.VM.Standard.E3.1.8GB',   ocpu: 1, memoryGb: 8   } },
  { awsService: 'AmazonRDS', awsInstanceType: 'db.t3.small',   gcp: { service: 'Cloud SQL', machineType: 'db-g1-small'       }, azure: { service: 'Azure Database for PostgreSQL Flexible Server', skuName: 'Standard_B2ms',   sku: 'Standard_B2ms'   }, oci: { service: 'MySQL Database Service', shape: 'MySQL.VM.Standard.E3.1.8GB',   ocpu: 1, memoryGb: 8   } },
  { awsService: 'AmazonRDS', awsInstanceType: 'db.t3.medium',  gcp: { service: 'Cloud SQL', machineType: 'db-custom-2-4096'  }, azure: { service: 'Azure Database for PostgreSQL Flexible Server', skuName: 'Standard_D2ds_v4', sku: 'Standard_D2ds_v4' }, oci: { service: 'MySQL Database Service', shape: 'MySQL.VM.Standard.E3.2.16GB',  ocpu: 2, memoryGb: 16  } },
  { awsService: 'AmazonRDS', awsInstanceType: 'db.t3.large',   gcp: { service: 'Cloud SQL', machineType: 'db-custom-2-8192'  }, azure: { service: 'Azure Database for PostgreSQL Flexible Server', skuName: 'Standard_D4ds_v4', sku: 'Standard_D4ds_v4' }, oci: { service: 'MySQL Database Service', shape: 'MySQL.VM.Standard.E3.4.32GB',  ocpu: 4, memoryGb: 32  } },
  // PostgreSQL / MySQL — db.m6g
  { awsService: 'AmazonRDS', awsInstanceType: 'db.m6g.large',  gcp: { service: 'Cloud SQL', machineType: 'db-custom-2-8192'  }, azure: { service: 'Azure Database for PostgreSQL Flexible Server', skuName: 'Standard_D4ds_v4', sku: 'Standard_D4ds_v4' }, oci: { service: 'MySQL Database Service', shape: 'MySQL.VM.Standard.E3.4.32GB',  ocpu: 2, memoryGb: 16  } },
  { awsService: 'AmazonRDS', awsInstanceType: 'db.m6g.xlarge', gcp: { service: 'Cloud SQL', machineType: 'db-custom-4-16384' }, azure: { service: 'Azure Database for PostgreSQL Flexible Server', skuName: 'Standard_D8ds_v4', sku: 'Standard_D8ds_v4' }, oci: { service: 'MySQL Database Service', shape: 'MySQL.VM.Standard.E3.8.64GB',  ocpu: 4, memoryGb: 32  } },
  { awsService: 'AmazonRDS', awsInstanceType: 'db.r6g.large',  gcp: { service: 'Cloud SQL', machineType: 'db-custom-2-16384' }, azure: { service: 'Azure Database for PostgreSQL Flexible Server', skuName: 'Standard_E4ds_v4', sku: 'Standard_E4ds_v4' }, oci: { service: 'MySQL Database Service', shape: 'MySQL.VM.Standard.E3.4.64GB',  ocpu: 2, memoryGb: 32  } },
  { awsService: 'AmazonRDS', awsInstanceType: 'db.r6g.xlarge', gcp: { service: 'Cloud SQL', machineType: 'db-custom-4-32768' }, azure: { service: 'Azure Database for PostgreSQL Flexible Server', skuName: 'Standard_E8ds_v4', sku: 'Standard_E8ds_v4' }, oci: { service: 'MySQL Database Service', shape: 'MySQL.VM.Standard.E3.8.128GB', ocpu: 4, memoryGb: 64  } },
  { awsService: 'AmazonRDS', awsInstanceType: 'db.r6g.2xlarge',gcp: { service: 'Cloud SQL', machineType: 'db-custom-8-65536' }, azure: { service: 'Azure Database for PostgreSQL Flexible Server', skuName: 'Standard_E16ds_v4',sku: 'Standard_E16ds_v4'},oci: { service: 'MySQL Database Service', shape: 'MySQL.VM.Standard.E3.16.256GB',ocpu: 8, memoryGb: 128 } },
];

// ─── ElastiCache ──────────────────────────────────────────────────────────────

const ELASTICACHE_MAPPINGS: StaticSkuEntry[] = [
  { awsService: 'AmazonElastiCache', awsInstanceType: 'cache.t3.micro',   gcp: { service: 'Memorystore', machineType: 'M1_BASIC'          }, azure: { service: 'Azure Cache for Redis', skuName: 'Basic C0',     sku: 'Basic C0'     }, oci: { service: 'Cache with Redis', shape: 'BM.Standard.E2.64', ocpu: 1,  memoryGb: 1   } },
  { awsService: 'AmazonElastiCache', awsInstanceType: 'cache.t3.small',   gcp: { service: 'Memorystore', machineType: 'M1_BASIC'          }, azure: { service: 'Azure Cache for Redis', skuName: 'Basic C1',     sku: 'Basic C1'     }, oci: { service: 'Cache with Redis', shape: 'BM.Standard.E2.64', ocpu: 1,  memoryGb: 2   } },
  { awsService: 'AmazonElastiCache', awsInstanceType: 'cache.t3.medium',  gcp: { service: 'Memorystore', machineType: 'M1_BASIC'          }, azure: { service: 'Azure Cache for Redis', skuName: 'Standard C1',  sku: 'Standard C1'  }, oci: { service: 'Cache with Redis', shape: 'BM.Standard.E2.64', ocpu: 2,  memoryGb: 4   } },
  { awsService: 'AmazonElastiCache', awsInstanceType: 'cache.r7g.large',  gcp: { service: 'Memorystore', machineType: 'M1_STANDARD_2'     }, azure: { service: 'Azure Cache for Redis', skuName: 'Standard C2',  sku: 'Standard C2'  }, oci: { service: 'Cache with Redis', shape: 'BM.Standard.E2.64', ocpu: 2,  memoryGb: 13  } },
  { awsService: 'AmazonElastiCache', awsInstanceType: 'cache.r7g.xlarge', gcp: { service: 'Memorystore', machineType: 'M1_STANDARD_4'     }, azure: { service: 'Azure Cache for Redis', skuName: 'Standard C3',  sku: 'Standard C3'  }, oci: { service: 'Cache with Redis', shape: 'BM.Standard.E2.64', ocpu: 4,  memoryGb: 26  } },
  { awsService: 'AmazonElastiCache', awsInstanceType: 'cache.r6g.large',  gcp: { service: 'Memorystore', machineType: 'M1_STANDARD_2'     }, azure: { service: 'Azure Cache for Redis', skuName: 'Standard C2',  sku: 'Standard C2'  }, oci: { service: 'Cache with Redis', shape: 'BM.Standard.E2.64', ocpu: 2,  memoryGb: 13  } },
  { awsService: 'AmazonElastiCache', awsInstanceType: 'cache.r6g.xlarge', gcp: { service: 'Memorystore', machineType: 'M1_STANDARD_4'     }, azure: { service: 'Azure Cache for Redis', skuName: 'Standard C3',  sku: 'Standard C3'  }, oci: { service: 'Cache with Redis', shape: 'BM.Standard.E2.64', ocpu: 4,  memoryGb: 26  } },
];

// ─── Índice: instanceType → entry ─────────────────────────────────────────────

const ALL_ENTRIES: StaticSkuEntry[] = [
  ...EC2_MAPPINGS,
  ...RDS_MAPPINGS,
  ...ELASTICACHE_MAPPINGS,
];

const INDEX = new Map<string, StaticSkuEntry>(
  ALL_ENTRIES.map((e) => [e.awsInstanceType.toLowerCase(), e]),
);

/**
 * Tenta encontrar um mapeamento estático para o instanceType informado.
 * Aceita variações de sufixo (ex: "m7g.2xlarge" e "m7g.2xlarge - on demand").
 */
export function lookupStaticSku(instanceType: string): StaticSkuEntry | null {
  const normalized = instanceType.toLowerCase().trim().split(/\s/)[0];
  return INDEX.get(normalized) ?? null;
}

// ─── Listas de SKUs válidos por provedor (usados como constraint para o Claude) ─

export const VALID_GCP_MACHINE_TYPES: string[] = Array.from(
  new Set(ALL_ENTRIES.map((e) => e.gcp.machineType)),
).sort();

export const VALID_GCP_SERVICES: string[] = [
  'Compute Engine',
  'Cloud SQL',
  'Cloud Storage',
  'Cloud Run',
  'BigQuery',
  'Memorystore',
  'Cloud Armor',
  'AlloyDB',
];

export const VALID_AZURE_SKUS: string[] = Array.from(
  new Set(ALL_ENTRIES.map((e) => e.azure.skuName)),
).sort();

export const VALID_AZURE_SERVICES: string[] = [
  'Virtual Machines',
  'Azure Database for PostgreSQL Flexible Server',
  'Azure Database for MySQL Flexible Server',
  'Azure Blob Storage',
  'Azure Cache for Redis',
  'Azure Application Gateway',
];

export const VALID_AWS_SERVICES: string[] = [
  'AmazonEC2',
  'AmazonRDS',
  'AmazonS3',
  'AWSLambda',
  'AmazonElastiCache',
  'AWSWAFv2',
];

export const VALID_OCI_SHAPES: string[] = Array.from(
  new Set(ALL_ENTRIES.map((e) => e.oci.shape)),
).sort();

export const VALID_OCI_SERVICES: string[] = [
  'Compute',
  'MySQL Database Service',
  'Object Storage',
  'Cache with Redis',
  'Load Balancer',
  'Container Engine for Kubernetes',
];
