import type { MapConnectionEdge, MapSignature, MapSystemNode } from '@/types';
import type { BookmarkInput, BookmarkScheme } from './types';

/** Renders a possibly-null scalar; null becomes `-`. */
function fmt(value: string | number | null): string {
  return value === null ? '-' : String(value);
}

function renderEndpoint(
  node: MapSystemNode,
  hopsFromHome: ReadonlyMap<string, number>,
  homeMapSystemId: string | null,
): string {
  const hop = hopsFromHome.get(node.id);
  const statics =
    node.statics.length === 0 ? 'none' : node.statics.map((s) => s.label).join('+');
  const tradeHub = node.tradeHub === null ? '-' : `${node.tradeHub.name}@${node.tradeHub.jumps}j`;
  return [
    `NAME=${fmt(node.name)}`,
    `ALIAS=${fmt(node.alias)}`,
    `TAG=${fmt(node.tag)}`,
    `STATUS=${fmt(node.status)}`,
    `SEC=${fmt(node.security)}`,
    `TRUESEC=${fmt(node.trueSec)}`,
    `EFFECT=${fmt(node.effect)}`,
    `REGION=${fmt(node.regionName)}`,
    `CONST=${fmt(node.constellationName)}`,
    `STATICS=${statics}`,
    `HUB=${tradeHub}`,
    `HOPS=${hop === undefined ? '-' : hop}`,
    `HOME=${node.id === homeMapSystemId}`,
  ].join('|');
}

function renderConnection(connection: MapConnectionEdge): string {
  return [
    `SCOPE=${fmt(connection.scope)}`,
    `MASS=${fmt(connection.massStatus)}`,
    `JUMPCLASS=${fmt(connection.jumpMassClass)}`,
    `EOL=${fmt(connection.eolStage)}`,
    `EOLAT=${fmt(connection.eolAt)}`,
    `CREATED=${fmt(connection.createdAt)}`,
    `STATIC=${connection.isStatic}`,
    `ROLLING=${connection.isRolling}`,
    `PRESERVE=${connection.preserveMass}`,
    `SRCBUBBLE=${connection.sourceBubbled}`,
    `TGTBUBBLE=${connection.targetBubbled}`,
  ].join('|');
}

function renderSignature(sig: MapSignature | undefined): string {
  if (!sig) return 'SIG=none';
  return [
    `SIGID=${fmt(sig.sigId)}`,
    `WHCODE=${fmt(sig.wormholeCode)}`,
    `GROUP=${fmt(sig.groupKey)}`,
    `CLASS=${fmt(sig.classKind)}`,
    `SIGEOL=${fmt(sig.eolStage)}`,
    `SIGNAME=${fmt(sig.name)}`,
    `DESC=${fmt(sig.description)}`,
    `EXPIRES=${fmt(sig.expiresAt)}`,
  ].join('|');
}

function buildName(
  self: MapSystemNode,
  other: MapSystemNode,
  selfSig: MapSignature | undefined,
  otherSig: MapSignature | undefined,
  connection: MapConnectionEdge,
  hopsFromHome: ReadonlyMap<string, number>,
  homeMapSystemId: string | null,
): string {
  return [
    `HERE[${renderEndpoint(self, hopsFromHome, homeMapSystemId)}]`,
    `OTHER[${renderEndpoint(other, hopsFromHome, homeMapSystemId)}]`,
    `WH[${renderConnection(connection)}]`,
    `HERESIG[${renderSignature(selfSig)}]`,
    `OTHERSIG[${renderSignature(otherSig)}]`,
  ].join(' :: ');
}

/**
 * The product default naming scheme. Concatenates every readable field of the
 * transit into one long delimited string per endpoint, in full — this is a
 * reference implementation meant to exercise the whole `BookmarkScheme`
 * surface, not a name meant to fit in EVE's in-game bookmark field.
 */
export const referenceScheme: BookmarkScheme = {
  names(input: BookmarkInput) {
    const hereSig = input.signatures.find((s) => s.mapSystemId === input.here.id);
    const cameFromSig = input.signatures.find((s) => s.mapSystemId === input.cameFrom.id);
    return {
      here: buildName(
        input.here,
        input.cameFrom,
        hereSig,
        cameFromSig,
        input.connection,
        input.hopsFromHome,
        input.homeMapSystemId,
      ),
      cameFrom: buildName(
        input.cameFrom,
        input.here,
        cameFromSig,
        hereSig,
        input.connection,
        input.hopsFromHome,
        input.homeMapSystemId,
      ),
    };
  },
};
