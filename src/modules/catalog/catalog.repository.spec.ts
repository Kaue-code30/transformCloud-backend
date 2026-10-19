import type { PrismaService } from '../../prisma/prisma.service';
import { CatalogRepository } from './catalog.repository';

describe('CatalogRepository', () => {
  it('reutiliza preço global OCI quando não existe cópia regional da oferta', async () => {
    const globalOffering = {
      id: 'oci-egress-global',
      sourceKey: 'OCI_PRICE_LIST:sa-saopaulo-1:internet-egress',
      provider: 'OCI',
      nativeProductId: 'B93455',
      nativeSkuName: 'Internet-Egress',
      displayName: 'Internet Egress',
      region: 'sa-saopaulo-1',
      purchaseOption: 'ON_DEMAND',
      operatingSystem: null,
      architecture: null,
      family: null,
      generation: null,
      engine: null,
      vcpu: null,
      memoryGiB: null,
      highAvailability: null,
      service: {
        resourceKind: 'DATA_TRANSFER',
        name: 'Networking - Virtual Cloud Networks',
        nativeCode: 'OCI:DATA_TRANSFER:VCN',
      },
    };
    const findMany = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([globalOffering]);
    const prisma = {
      providerOffering: { findMany },
    } as unknown as PrismaService;
    const repository = new CatalogRepository(prisma);

    const result = await repository.findResourceCandidates({
      provider: 'OCI',
      resourceKind: 'DATA_TRANSFER',
      region: 'us-ashburn-1',
      pricingUnits: ['GB'],
    });

    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany.mock.calls[1][0].where.attributes).toEqual({
      path: ['globalListPrice'],
      equals: true,
    });
    expect(result[0]).toMatchObject({
      id: 'oci-egress-global',
      region: 'us-ashburn-1',
    });
  });
});
