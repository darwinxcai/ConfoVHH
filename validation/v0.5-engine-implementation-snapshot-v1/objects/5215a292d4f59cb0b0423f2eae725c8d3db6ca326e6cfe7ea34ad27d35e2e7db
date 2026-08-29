import {
  CANONICAL_SASA_FRAME_ALGORITHM,
  CDR_ANNOTATION_METHOD_DESCRIPTION,
  CONFOVHH_VERSION,
  PAE_SUMMARY_METHOD_DESCRIPTION,
  SASA_RADII_METHOD_DESCRIPTION,
  classifyCoordinateProvenance,
  summarizeContactPae,
  verifyInterfaceAuditAttestation,
  type InterfaceAudit,
  type ParsedPae,
  type ParsedStructure,
} from "./confovhh.ts";
import {
  selectedCoordinateFingerprint,
  selectedGeometryFingerprint,
} from "./pose-ensemble.ts";

export const SINGLE_AUDIT_EXPORT_SCHEMA_VERSION = "1.2.0";

export interface SingleAuditExportInput {
  filename: string;
  coordinateSha256: string;
  coordinateBytes: number;
  structure: ParsedStructure;
  receptorChain: string;
  vhhChain: string;
  chainIdentityConfirmed: boolean;
  pae: ParsedPae | null;
  paeSha256: string | null;
  paeOrderConfirmed: boolean;
  audit: InterfaceAudit;
  generatedAt?: string;
}

function requireSha256(value: string, label: string): void {
  if (!/^[0-9a-f]{64}$/i.test(value)) {
    throw new Error(`${label} must be a 64-character hexadecimal SHA-256 digest.`);
  }
}

function requireByteCount(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
}

function requireIsoTimestamp(value: string, label: string): void {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new Error(`${label} must be a valid UTC ISO 8601 timestamp with millisecond precision.`);
  }
}

function assertFiniteJsonNumbers(
  value: unknown,
  path = "report",
  ancestors = new WeakSet<object>(),
): void {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`${path} contains a non-finite number that cannot be exported faithfully.`);
    }
    return;
  }
  if (value == null || typeof value !== "object") return;
  if (ancestors.has(value)) throw new Error(`${path} contains a cyclic value and cannot be exported.`);
  ancestors.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertFiniteJsonNumbers(entry, `${path}[${index}]`, ancestors));
  } else {
    for (const [key, entry] of Object.entries(value)) {
      assertFiniteJsonNumbers(entry, `${path}.${key}`, ancestors);
    }
  }
  ancestors.delete(value);
}

const PAE_SUMMARY_FIELDS = [
  "receptorFrameToVhhPaeMedianAngstrom",
  "vhhFrameToReceptorPaeMedianAngstrom",
  "receptorFrameToVhhPaeP90Angstrom",
  "vhhFrameToReceptorPaeP90Angstrom",
  "interfacePaeMedianAngstrom",
  "interfacePaeP90Angstrom",
  "lowPaeContactShare",
] as const;

function validateAuditInvariants(
  structure: ParsedStructure,
  receptorChain: string,
  vhhChain: string,
  audit: InterfaceAudit,
): void {
  const receptor = structure.chains.find((chain) => chain.id === receptorChain)!;
  const vhh = structure.chains.find((chain) => chain.id === vhhChain)!;
  if (!["none", "plddt"].includes(audit.confidenceMode)) {
    throw new Error("The audit confidence mode is invalid.");
  }
  if (!["supported", "mixed", "limited", "not-assessable"].includes(audit.evidenceLevel)) {
    throw new Error("The audit evidence level is invalid.");
  }
  if (typeof audit.rationale !== "string" || !audit.rationale.trim()) {
    throw new Error("The audit requires a non-empty evidence rationale.");
  }

  const countFields = [
    "contactPairCount",
    "atomContactCount",
    "receptorInterfaceResidues",
    "vhhInterfaceResidues",
    "polarContactProxyCount",
    "saltBridgeProxyCount",
    "severeClashCount",
    "possibleInterchainDisulfideCount",
  ] as const;
  for (const field of countFields) {
    if (!Number.isSafeInteger(audit[field]) || audit[field] < 0) {
      throw new Error(`The audit ${field} must be a non-negative safe integer.`);
    }
  }
  if (audit.atomContactCount < audit.contactPairCount) {
    throw new Error("The audit atom-contact count cannot be smaller than its residue-contact count.");
  }
  for (const field of ["polarContactProxyCount", "saltBridgeProxyCount"] as const) {
    if (audit[field] > audit.atomContactCount) {
      throw new Error(`The audit ${field} cannot exceed atomContactCount.`);
    }
  }
  for (const field of ["severeClashCount", "possibleInterchainDisulfideCount"] as const) {
    if (audit[field] > audit.contactPairCount) {
      throw new Error(`The audit ${field} cannot exceed contactPairCount.`);
    }
  }

  const nonnegativeFields = [
    "maximumOverlapAngstrom",
    "deltaSasaAngstrom2",
    "receptorBuriedSurfaceAreaAngstrom2",
    "vhhBuriedSurfaceAreaAngstrom2",
    "halfDeltaSasaInterfaceAreaAngstrom2",
  ] as const;
  for (const field of nonnegativeFields) {
    if (!Number.isFinite(audit[field]) || audit[field] < 0) {
      throw new Error(`The audit ${field} must be finite and non-negative.`);
    }
  }
  const sasaTolerance = Math.max(1e-8, audit.deltaSasaAngstrom2 * 1e-10);
  if (Math.abs(
    audit.receptorBuriedSurfaceAreaAngstrom2 +
    audit.vhhBuriedSurfaceAreaAngstrom2 -
    audit.deltaSasaAngstrom2
  ) > sasaTolerance) {
    throw new Error("The audit receptor and VHH buried areas do not reconcile with protein ΔSASA.");
  }
  if (Math.abs(
    audit.halfDeltaSasaInterfaceAreaAngstrom2 - audit.deltaSasaAngstrom2 / 2
  ) > sasaTolerance) {
    throw new Error("The audit half-ΔSASA interface area does not reconcile with protein ΔSASA.");
  }
  for (const field of ["paratopeProxyShare", "cdr3ProxyShare"] as const) {
    const value = audit[field];
    if (value != null && (!Number.isFinite(value) || value < 0 || value > 1)) {
      throw new Error(`The audit ${field} must be null or within [0, 1].`);
    }
  }
  if (audit.confidenceMode === "none") {
    if (audit.interfaceConfidence != null || audit.interfaceConfidenceCoverage != null) {
      throw new Error("A coordinate-only audit cannot contain interface confidence values.");
    }
  } else {
    if (audit.interfaceConfidence != null && (
      !Number.isFinite(audit.interfaceConfidence) ||
      audit.interfaceConfidence < 0 || audit.interfaceConfidence > 100
    )) throw new Error("Audit interface confidence must be null or within [0, 100].");
    if (audit.interfaceConfidenceCoverage != null && (
      !Number.isFinite(audit.interfaceConfidenceCoverage) ||
      audit.interfaceConfidenceCoverage < 0 || audit.interfaceConfidenceCoverage > 1
    )) throw new Error("Audit interface confidence coverage must be null or within [0, 1].");
  }

  const methods = audit.methods;
  const expectedMethods = {
    residueContactCutoffAngstrom: 4.5,
    polarProxyCutoffAngstrom: 3.5,
    saltBridgeProxyCutoffAngstrom: 4,
    severeClashOverlapAngstrom: 0.6,
    sasaProbeRadiusAngstrom: 1.4,
    sasaSpherePoints: 960,
    sasaMaximumCandidateDistanceChecks: 25_000_000,
    sasaMaximumOcclusionChecks: 250_000_000,
  } as const;
  for (const [field, expected] of Object.entries(expectedMethods)) {
    if (methods?.[field as keyof typeof expectedMethods] !== expected) {
      throw new Error(`The audit methods.${field} value does not match the current fixed audit policy.`);
    }
  }
  for (const field of ["sasaRadii", "cdrAnnotation", "paeSummary"] as const) {
    if (typeof methods?.[field] !== "string" || !methods[field].trim()) {
      throw new Error(`The audit requires a non-empty methods.${field} description.`);
    }
  }
  const expectedMethodDescriptions = {
    sasaRadii: SASA_RADII_METHOD_DESCRIPTION,
    cdrAnnotation: CDR_ANNOTATION_METHOD_DESCRIPTION,
    paeSummary: PAE_SUMMARY_METHOD_DESCRIPTION,
  } as const;
  for (const [field, expected] of Object.entries(expectedMethodDescriptions)) {
    if (methods[field as keyof typeof expectedMethodDescriptions] !== expected) {
      throw new Error(`The audit methods.${field} description does not match the current fixed audit policy.`);
    }
  }
  const validSasaPair =
    (methods?.sasaOrientation === "source-coordinate-frame" &&
      methods.sasaFrameAlgorithm === "source-coordinates-as-supplied-v1") ||
    (methods?.sasaOrientation === "deterministic-proper-signed-frame" &&
      methods.sasaFrameAlgorithm === CANONICAL_SASA_FRAME_ALGORITHM);
  if (!validSasaPair) {
    throw new Error("The audit SASA orientation and frame algorithm provenance are inconsistent.");
  }

  if (!Array.isArray(audit.contacts) || audit.contacts.length !== audit.contactPairCount) {
    throw new Error("The audit contact records do not reconcile with contactPairCount.");
  }
  const receptorByOrder = new Map(receptor.residues.map((residue) => [residue.order, residue]));
  const vhhByOrder = new Map(vhh.residues.map((residue) => [residue.order, residue]));
  const seenPairs = new Set<string>();
  const permittedContactTypes = new Set([
    "severe vdW overlap",
    "possible interchain disulfide",
    "salt-bridge proxy",
    "potential polar contact",
    "close contact",
  ]);
  const permittedVhhRegions = new Set([
    "FR1-IMGT", "CDR1-IMGT", "FR2-IMGT", "CDR2-IMGT",
    "FR3-IMGT", "CDR3-IMGT", "FR4-IMGT", "Unnumbered",
  ]);
  const observedReceptorOrders = new Set<number>();
  const observedVhhOrders = new Set<number>();
  for (const contact of audit.contacts) {
    if (!receptorByOrder.has(contact.receptorResidueOrder) ||
        !vhhByOrder.has(contact.vhhResidueOrder)) {
      throw new Error("An audit contact residue order is absent from the selected coordinate chains.");
    }
    if (!Number.isFinite(contact.minimumDistance) || contact.minimumDistance < 0 ||
        contact.minimumDistance > methods.residueContactCutoffAngstrom) {
      throw new Error("An audit contact minimum distance is outside the fixed contact cutoff.");
    }
    if (!Array.isArray(contact.contactTypes) || !contact.contactTypes.length ||
        contact.contactTypes.some((value) => typeof value !== "string" || !permittedContactTypes.has(value))) {
      throw new Error("Every audit contact requires one or more named contact types.");
    }
    for (const field of [
      "receptorResidue", "vhhResidue", "receptorResidueName", "vhhResidueName", "vhhRegion",
    ] as const) {
      if (typeof contact[field] !== "string" || !contact[field].trim()) {
        throw new Error(`Every audit contact requires a non-empty ${field} value.`);
      }
    }
    if (contact.vhhImgtPosition != null && typeof contact.vhhImgtPosition !== "string") {
      throw new Error("Audit contact IMGT positions must be strings or null.");
    }
    const receptorResidue = receptorByOrder.get(contact.receptorResidueOrder)!;
    const vhhResidue = vhhByOrder.get(contact.vhhResidueOrder)!;
    const receptorLabel = `${receptorResidue.name} ${receptorResidue.chainId}:${receptorResidue.number}${receptorResidue.insertionCode}`;
    const vhhLabel = `${vhhResidue.name} ${vhhResidue.chainId}:${vhhResidue.number}${vhhResidue.insertionCode}`;
    if (
      contact.receptorResidueName !== receptorResidue.name ||
      contact.vhhResidueName !== vhhResidue.name ||
      contact.receptorResidue !== receptorLabel ||
      contact.vhhResidue !== vhhLabel
    ) {
      throw new Error("Audit contact residue labels and names must match the selected coordinate residues.");
    }
    if (!permittedVhhRegions.has(contact.vhhRegion)) {
      throw new Error("Audit contact VHH regions must use the supported IMGT or Unnumbered vocabulary.");
    }
    for (const field of ["receptorConfidence", "vhhConfidence"] as const) {
      const value = contact[field];
      if (audit.confidenceMode === "none" && value != null) {
        throw new Error("Coordinate-only audit contacts cannot contain confidence values.");
      }
      if (value != null && (!Number.isFinite(value) || value < 0 || value > 100)) {
        throw new Error("Audit contact confidence values must be null or within [0, 100].");
      }
    }
    const pair = JSON.stringify([contact.receptorResidueOrder, contact.vhhResidueOrder]);
    if (seenPairs.has(pair)) throw new Error("The audit contains a duplicate residue-contact pair.");
    seenPairs.add(pair);
    observedReceptorOrders.add(contact.receptorResidueOrder);
    observedVhhOrders.add(contact.vhhResidueOrder);
  }
  if (observedReceptorOrders.size !== audit.receptorInterfaceResidues ||
      observedVhhOrders.size !== audit.vhhInterfaceResidues) {
    throw new Error("The audit interface-residue counts do not reconcile with contact records.");
  }
  const expectedReceptorKeys = new Set(
    [...observedReceptorOrders].map((order) => receptorByOrder.get(order)!.key),
  );
  const expectedVhhKeys = new Set(
    [...observedVhhOrders].map((order) => vhhByOrder.get(order)!.key),
  );
  const receptorKeys = Array.isArray(audit.receptorInterfaceKeys)
    ? new Set(audit.receptorInterfaceKeys)
    : new Set<string>();
  const vhhKeys = Array.isArray(audit.vhhInterfaceKeys)
    ? new Set(audit.vhhInterfaceKeys)
    : new Set<string>();
  if (
    receptorKeys.size !== expectedReceptorKeys.size ||
    vhhKeys.size !== expectedVhhKeys.size ||
    [...receptorKeys].some((key) => typeof key !== "string" || !key.trim() || !expectedReceptorKeys.has(key)) ||
    [...vhhKeys].some((key) => typeof key !== "string" || !key.trim() || !expectedVhhKeys.has(key))
  ) {
    throw new Error("The audit interface-key inventories do not reconcile with interface-residue counts.");
  }
  if (!Array.isArray(audit.findings) || audit.findings.some((finding) => (
    typeof finding?.label !== "string" || !finding.label.trim() ||
    !["supported", "review", "limited", "unavailable"].includes(finding.level) ||
    typeof finding.evidence !== "string" || !finding.evidence.trim() ||
    typeof finding.action !== "string" || !finding.action.trim()
  ))) throw new Error("The audit findings are incomplete or invalid.");
  if (!Array.isArray(audit.warnings) || audit.warnings.some((warning) => typeof warning !== "string")) {
    throw new Error("The audit warnings must be an array of strings.");
  }
  if (
    audit.vhhNumbering == null || audit.vhhNumbering.scheme !== "IMGT" ||
    typeof audit.vhhNumbering.engine !== "string" || !audit.vhhNumbering.engine.trim()
  ) throw new Error("The audit VHH-numbering provenance is incomplete.");
}

function validateAuditPaeConsistency(
  structure: ParsedStructure,
  receptorChain: string,
  vhhChain: string,
  audit: InterfaceAudit,
  pae: ParsedPae | null,
  paeOrderConfirmed: boolean,
): void {
  if (pae == null) {
    if (audit.paeFilename != null || audit.paeOrderConfirmed !== false) {
      throw new Error("The audit records attached PAE provenance but no PAE matrix was supplied for export.");
    }
    for (const field of PAE_SUMMARY_FIELDS) {
      if (audit[field] != null) {
        throw new Error(`The audit contains ${field} even though no PAE matrix was supplied for export.`);
      }
    }
    return;
  }

  if (typeof pae.filename !== "string" || !pae.filename.trim()) {
    throw new Error("Attached PAE export requires a non-empty source filename.");
  }
  if (audit.paeFilename !== pae.filename) {
    throw new Error("The audit PAE filename does not match the attached PAE source.");
  }
  if (audit.paeOrderConfirmed !== true || paeOrderConfirmed !== true) {
    throw new Error("The audit and export must both record explicit PAE residue-order confirmation.");
  }
  const expected = summarizeContactPae(
    structure,
    receptorChain,
    vhhChain,
    audit.contacts,
    pae,
  );
  for (const field of PAE_SUMMARY_FIELDS) {
    if (!Object.is(audit[field], expected[field])) {
      throw new Error(`The audit ${field} value does not match the attached PAE matrix and audited contacts.`);
    }
  }
}

function selectedChainRecord(
  structure: ParsedStructure,
  chainId: string,
  role: "receptor" | "VHH",
) {
  const chain = structure.chains.find((candidate) => candidate.id === chainId);
  if (!chain) throw new Error(`Selected ${role} chain ${chainId} is missing from the parsed structure.`);
  return {
    id: chain.id,
    role,
    sequence: chain.sequence,
    residueCount: chain.residueCount,
    atomCount: chain.atomCount,
    backboneCompleteness: chain.backboneCompleteness,
    labelAsymId: chain.labelAsymId ?? null,
    authAsymId: chain.authAsymId ?? null,
    assemblyCopyIndex: chain.assemblyCopyIndex ?? null,
    assemblyGeneratorRowIndex: chain.assemblyGeneratorRowIndex ?? null,
    assemblyOperationIds: [...(chain.assemblyOperationIds ?? [])],
    assemblyTransform: chain.assemblyTransform == null
      ? null
      : chain.assemblyTransform.map((row) => [...row]),
  };
}

function validateStructureExportProvenance(structure: ParsedStructure): void {
  if (structure.sourceFormat !== "pdb" && structure.sourceFormat !== "mmcif") {
    throw new Error("Audit export coordinate source format is invalid.");
  }
  if (
    structure.coordinateScope !== "as-supplied" &&
    structure.coordinateScope !== "deposited-assembly"
  ) {
    throw new Error("Audit export coordinate scope is invalid.");
  }
  if (
    !Number.isSafeInteger(structure.modelCount) || structure.modelCount < 1 ||
    !Array.isArray(structure.availableModelIds) ||
    structure.availableModelIds.length !== structure.modelCount ||
    new Set(structure.availableModelIds).size !== structure.availableModelIds.length ||
    structure.availableModelIds.some((id) => typeof id !== "string" || !id) ||
    typeof structure.selectedModelId !== "string" ||
    !structure.availableModelIds.includes(structure.selectedModelId)
  ) {
    throw new Error("Audit export coordinate-model provenance is inconsistent.");
  }
  for (const [field, value] of Object.entries({
    ignoredAlternateLocations: structure.ignoredAlternateLocations,
    ignoredHydrogens: structure.ignoredHydrogens,
    duplicateAtomRecords: structure.duplicateAtomRecords,
    malformedAtomRecords: structure.malformedAtomRecords,
    unsupportedResidueRecords: structure.unsupportedResidueRecords,
    zeroOccupancyAtomRecords: structure.zeroOccupancyAtomRecords,
    residueNameConflicts: structure.residueNameConflicts,
  })) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Audit export parser-accounting field ${field} is invalid.`);
    }
  }
  if (!Array.isArray(structure.availableAssemblies)) {
    throw new Error("Audit export requires a bounded deposited-assembly inventory.");
  }
  const selectedAssemblyId = structure.selectedAssembly?.id ?? null;
  const assemblyIds = structure.availableAssemblies.map((assembly) => assembly.id);
  if (
    new Set(assemblyIds).size !== assemblyIds.length ||
    assemblyIds.some((id) => typeof id !== "string" || !id) ||
    (selectedAssemblyId != null && !assemblyIds.includes(selectedAssemblyId)) ||
    (structure.coordinateScope === "as-supplied" && structure.selectedAssembly != null) ||
    (structure.coordinateScope === "deposited-assembly" &&
      (structure.sourceFormat !== "mmcif" || structure.selectedAssembly == null)) ||
    (structure.sourceFormat === "pdb" && structure.availableAssemblies.length !== 0)
  ) {
    throw new Error("Audit export coordinate scope and deposited-assembly provenance are inconsistent.");
  }
}

function createPaeResidueIndexMap(structure: ParsedStructure) {
  let matrixIndex = 0;
  return structure.chains.flatMap((chain) => chain.residues.map((residue) => {
    const entry = {
      matrixIndex,
      chainId: chain.id,
      labelAsymId: chain.labelAsymId ?? null,
      authAsymId: chain.authAsymId ?? null,
      assemblyCopyIndex: chain.assemblyCopyIndex ?? null,
      assemblyGeneratorRowIndex: chain.assemblyGeneratorRowIndex ?? null,
      assemblyOperationIds: [...(chain.assemblyOperationIds ?? [])],
      chainSequenceOrder: residue.order,
      labelSequenceId: residue.labelSequenceId ?? null,
      authSequenceId: residue.authSequenceId ?? residue.number,
      residueName: residue.name,
      residueNumber: residue.number,
      insertionCode: residue.insertionCode,
      residueKey: residue.key,
    };
    matrixIndex += 1;
    return entry;
  }));
}

export function createSingleAuditExportReport(input: SingleAuditExportInput) {
  const {
    filename,
    coordinateSha256,
    coordinateBytes,
    structure,
    receptorChain,
    vhhChain,
    chainIdentityConfirmed,
    pae,
    paeSha256,
    paeOrderConfirmed,
    audit,
    generatedAt = new Date().toISOString(),
  } = input;

  if (
    typeof filename !== "string" || !filename.trim() || filename.length > 1_024 ||
    /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(filename)
  ) {
    throw new Error("Audit export requires a bounded coordinate filename without control or invisible formatting characters.");
  }
  requireIsoTimestamp(generatedAt, "Audit export timestamp");
  requireSha256(coordinateSha256, "Coordinate source digest");
  requireByteCount(coordinateBytes, "Coordinate source byte count");
  if (chainIdentityConfirmed !== true) {
    throw new Error("Receptor and VHH chain identities must be explicitly confirmed before audit export.");
  }
  if (receptorChain === vhhChain) throw new Error("Audit export requires two different selected chains.");
  if (audit.receptorChain !== receptorChain || audit.vhhChain !== vhhChain) {
    throw new Error("The audit chain assignment does not match the selected export chains.");
  }
  if (audit.version !== CONFOVHH_VERSION) {
    throw new Error("The audit software version does not match this ConfoVHH export implementation.");
  }
  validateStructureExportProvenance(structure);

  const selectedChains = [
    selectedChainRecord(structure, receptorChain, "receptor"),
    selectedChainRecord(structure, vhhChain, "VHH"),
  ];
  validateAuditInvariants(structure, receptorChain, vhhChain, audit);
  const residueIndexMap = pae ? createPaeResidueIndexMap(structure) : null;
  if (pae) {
    if (paeSha256 == null) {
      throw new Error("Attached PAE requires its source SHA-256 digest.");
    }
    requireSha256(paeSha256, "PAE source digest");
    if (paeOrderConfirmed !== true) {
      throw new Error("Attached PAE residue order must be explicitly confirmed before export.");
    }
    if (residueIndexMap?.length !== pae.residueCount) {
      throw new Error("The PAE matrix residue count no longer matches the parsed coordinate residue order.");
    }
  } else if (paeSha256 != null || paeOrderConfirmed !== false) {
    throw new Error("PAE provenance or confirmation was supplied without an attached PAE matrix.");
  }
  validateAuditPaeConsistency(
    structure,
    receptorChain,
    vhhChain,
    audit,
    pae,
    paeOrderConfirmed,
  );
  verifyInterfaceAuditAttestation(
    structure,
    receptorChain,
    vhhChain,
    audit,
    pae,
    paeOrderConfirmed,
  );

  const rawFingerprint = selectedCoordinateFingerprint(
    structure,
    receptorChain,
    vhhChain,
  );
  const geometryFingerprint = selectedGeometryFingerprint(
    structure,
    receptorChain,
    vhhChain,
  );

  const report = {
    schemaVersion: SINGLE_AUDIT_EXPORT_SCHEMA_VERSION,
    softwareVersion: CONFOVHH_VERSION,
    generatedAt,
    file: filename,
    structure: {
      title: structure.title,
      experimentalMethod: structure.experimentalMethod,
      coordinateProvenance: classifyCoordinateProvenance(structure.experimentalMethod),
      sourceFileSha256: coordinateSha256.toLowerCase(),
      sourceFileBytes: coordinateBytes,
      selectedCoordinateFingerprint: rawFingerprint,
      selectedGeometryFingerprint: geometryFingerprint,
      fingerprintPolicy: {
        selectedCoordinateFingerprint: "FNV-1a 64-bit screening identifier over the selected receptor/VHH atom identities and source-frame coordinates rounded to 0.001 Å; it changes under rigid-body transforms.",
        selectedGeometryFingerprint: "FNV-1a 64-bit screening identifier over the selected receptor/VHH atom identities in a deterministic SE(3)-canonical frame rounded to 0.01 Å; prefix fnv1a64-se3-2dp.",
        decisionBoundary: "Fingerprints are provenance and candidate-screening identifiers, not cryptographic digests. Near-duplicate decisions use an explicit proper-rotation fit with independent RMSD and maximum-residual thresholds.",
      },
      sourceFormat: structure.sourceFormat,
      coordinateScope: structure.coordinateScope,
      modelCount: structure.modelCount,
      selectedModelId: structure.selectedModelId,
      availableModelIds: [...structure.availableModelIds],
      selectedAssembly: structure.selectedAssembly == null
        ? null
        : structuredClone(structure.selectedAssembly),
      availableAssemblies: structuredClone(structure.availableAssemblies),
      modelPolicy: "Exactly one explicitly selected coordinate model is audited; model identifiers are preserved from the source parser.",
      assemblyPolicy: structure.coordinateScope === "deposited-assembly"
        ? "User-selected depositor/PDB-supplied assembly operators were applied; physiological relevance was not inferred."
        : "Coordinates were analyzed as supplied. ConfoVHH applied no assembly transforms; the source file may already contain pre-expanded coordinates.",
      chainIdentityConfirmed,
      selectedChains,
      parserDiagnostics: {
        parserEngine: structure.sourceFormat === "mmcif"
          ? "ConfoVHH bounded CIF 1.1 tokenizer and PDBx category parser"
          : "ConfoVHH fixed-column PDB parser",
        ignoredAlternateLocations: structure.ignoredAlternateLocations,
        ignoredHydrogens: structure.ignoredHydrogens,
        duplicateAtomRecords: structure.duplicateAtomRecords,
        malformedAtomRecords: structure.malformedAtomRecords,
        unsupportedResidueRecords: structure.unsupportedResidueRecords,
        zeroOccupancyAtomRecords: structure.zeroOccupancyAtomRecords,
        residueNameConflicts: structure.residueNameConflicts,
        alternateLocationPolicy: "One residue-level conformer is selected by summed occupancy; blank atoms are shared, with A then deterministic code-unit tie-breaks.",
      },
    },
    pae: pae == null ? null : {
      filename: pae.filename,
      sha256: paeSha256!.toLowerCase(),
      residueCount: pae.residueCount,
      maxPaeAngstrom: pae.maxPaeAngstrom,
      sourceFormat: pae.sourceFormat,
      orderConfirmed: paeOrderConfirmed,
      directionConvention: "AlphaFold: row is alignment-frame residue; column is evaluated residue.",
      directionConventionConfirmed: paeOrderConfirmed,
      mappingMode: "Matrix dimensions checked; AlphaFold direction convention and complete parsed protein-residue order explicitly confirmed by the user.",
      matrixValuesExported: false,
      residueIndexMap: residueIndexMap!,
    },
    auditPolicy: {
      confidenceMode: audit.confidenceMode,
      pae: pae == null ? "omitted" : "attached-with-user-confirmed-direction-and-residue-order",
      residueContactCutoffAngstrom: audit.methods.residueContactCutoffAngstrom,
      polarProxyCutoffAngstrom: audit.methods.polarProxyCutoffAngstrom,
      saltBridgeProxyCutoffAngstrom: audit.methods.saltBridgeProxyCutoffAngstrom,
      severeClashOverlapAngstrom: audit.methods.severeClashOverlapAngstrom,
      sasaProbeRadiusAngstrom: audit.methods.sasaProbeRadiusAngstrom,
      sasaSpherePoints: audit.methods.sasaSpherePoints,
      sasaRadii: audit.methods.sasaRadii,
      sasaOrientation: audit.methods.sasaOrientation,
      sasaFrameAlgorithm: audit.methods.sasaFrameAlgorithm,
      sasaMaximumCandidateDistanceChecks: audit.methods.sasaMaximumCandidateDistanceChecks,
      sasaMaximumOcclusionChecks: audit.methods.sasaMaximumOcclusionChecks,
      cdrAnnotation: audit.methods.cdrAnnotation,
      paeSummary: audit.methods.paeSummary,
    },
    audit: structuredClone(audit),
  };
  assertFiniteJsonNumbers(report);
  return report;
}

export type SingleAuditExportReport = ReturnType<typeof createSingleAuditExportReport>;
