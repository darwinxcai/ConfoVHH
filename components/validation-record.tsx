import { AlertTriangle, CheckCircle2, FlaskConical } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RELEASE_VALIDATION } from "@/lib/release-validation";

function ratio(passed: number, total: number) {
  return `${passed}/${total}`;
}

export function ValidationRecord() {
  const record = RELEASE_VALIDATION;
  const publicAttestationStatus: string = record.publicV05RegressionAttestation.status;
  const publicAttested = publicAttestationStatus.startsWith("executed-");
  const PublicStatusIcon = publicAttested ? CheckCircle2 : AlertTriangle;
  const replayStatus: string = record.dockqV05RegressionReplay.status;
  const replayExecuted = replayStatus.startsWith("executed-");
  const ReplayStatusIcon = replayExecuted ? CheckCircle2 : AlertTriangle;
  return (
    <details className="panel release-validation" aria-label="ConfoVHH release validation record">
      <summary className="release-validation-summary">
        <span><FlaskConical /> Validation and scientific limits</span>
        <Badge variant="secondary">attested engine v{record.softwareVersion}</Badge>
      </summary>
      <div className="release-validation-body">
      <div className="panel-heading compact release-validation-heading">
        <div>
          <p className="eyebrow">06 · Release evidence</p>
          <h2>v{record.softwareVersion} release checks and historical evidence</h2>
          <p>
            Parser, transformation, geometry, regression, and benchmark-plumbing checks are kept separate from biological claims.
          </p>
        </div>
        <Badge variant="secondary"><FlaskConical /> validation record</Badge>
      </div>

      <div className="release-stat-grid">
        <article>
          <PublicStatusIcon aria-hidden="true" />
          <strong>{ratio(record.mmcifParity.exactMatches, record.mmcifParity.structures)}</strong>
          <span>{publicAttested ? "attested" : "frozen expectation"} · exact discrete PDB↔PDBx/mmCIF; ΔSASA ≤1×10⁻⁹ Å²</span>
        </article>
        <article>
          <PublicStatusIcon aria-hidden="true" />
          <strong>{ratio(record.depositedAssemblyOracles.exactCountMatches, record.depositedAssemblyOracles.structures)}</strong>
          <span>assembly counts + coordinates matched ≤0.00078 Å</span>
        </article>
        <article>
          <PublicStatusIcon aria-hidden="true" />
          <strong>{ratio(record.nativeInterfaceRegression.interfacesDetected, record.nativeInterfaceRegression.structures)}</strong>
          <span>native-coordinate interfaces detected</span>
        </article>
        <article>
          <PublicStatusIcon aria-hidden="true" />
          <strong>{ratio(record.nativeInterfaceRegression.wholeComplexTranslationInvariances, record.nativeInterfaceRegression.structures)}</strong>
          <span>translations preserved contacts + ΔSASA within tolerance</span>
        </article>
        <article>
          <PublicStatusIcon aria-hidden="true" />
          <strong>{ratio(record.nativeInterfaceRegression.farTranslationControlsRejected, record.nativeInterfaceRegression.farTranslationControls)}</strong>
          <span>far-translated VHH controls had zero contacts + ΔSASA</span>
        </article>
        <article>
          <CheckCircle2 aria-hidden="true" />
          <strong>{ratio(record.realPredictionRunRegression.coordinatePosesAccepted, record.realPredictionRunRegression.coordinatePoses)}</strong>
          <span>public generated AlphaFold Server + ColabFold poses completed with {record.realPredictionRunRegression.paeAttachmentsAudited}/10 PAE audits</span>
        </article>
        <article>
          <ReplayStatusIcon aria-hidden="true" />
          <strong>
            {replayExecuted
              ? ratio(
                  record.dockqV05RegressionReplay.exactCoordinateMatches,
                  record.dockqV05RegressionReplay.poses,
                )
              : "Pending"}
          </strong>
          <span>
            {replayExecuted
              ? "post-label replay · exact coordinates, DockQ + CAPRI"
              : "clean-tree v0.5 post-label replay"}
          </span>
        </article>
        <article>
          <AlertTriangle aria-hidden="true" />
          <strong>{record.stateContextNativeRegression.sameVhhCrossContextPairs}</strong>
          <span>same-VHH cross-context inventory pairs</span>
        </article>
      </div>

      <Alert className="release-boundary-alert" role="status">
        <PublicStatusIcon />
        <AlertTitle>
          {publicAttested
            ? "Current-release public regressions are commit-attested"
            : "Clean-tree v0.5 public attestation pending"}
        </AlertTitle>
        <AlertDescription>
          {publicAttested
            ? `The public parser, assembly, native-interface, and obvious-translation regression counts were reproduced from source commit ${record.publicV05RegressionAttestation.sourceCommit.slice(0, 12)} with raw-source and executed-dependency hashes. They remain coordinate regression evidence, not biological validation.`
            : "The displayed public-panel counts are frozen expectations and prior observations until the clean-tree attestation artifact is executed and committed."}
        </AlertDescription>
      </Alert>

      <div className="release-validation-table">
        <p>Historical v0.4 development-only DockQ pilot; positive prevalence was {(record.dockqDevelopmentPilot.primaryPositiveRate * 100).toFixed(1)}%.</p>
        <Table containerLabel="Scrollable release-validation comparison table">
          <TableHeader>
            <TableRow>
              <TableHead>Historical v0.4 DockQ development arm</TableHead>
              <TableHead>Target-macro AP</TableHead>
              <TableHead>AP / prevalence</TableHead>
              <TableHead>Target-macro AUROC</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>All-tied prevalence baseline</TableCell>
              <TableCell className="mono-cell">{record.dockqDevelopmentPilot.primaryPositiveRate.toFixed(3)}</TableCell>
              <TableCell className="mono-cell">1.000</TableCell>
              <TableCell className="mono-cell">0.500</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>ConfoVHH evidence band</TableCell>
              <TableCell className="mono-cell">{record.dockqDevelopmentPilot.evidenceBand.averagePrecision.toFixed(3)}</TableCell>
              <TableCell className="mono-cell">{record.dockqDevelopmentPilot.evidenceBand.averagePrecisionLift.toFixed(3)}</TableCell>
              <TableCell className="mono-cell">{record.dockqDevelopmentPilot.evidenceBand.auroc.toFixed(3)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Raw ΔSASA baseline</TableCell>
              <TableCell className="mono-cell">{record.dockqDevelopmentPilot.deltaSasa.averagePrecision.toFixed(3)}</TableCell>
              <TableCell className="mono-cell">{record.dockqDevelopmentPilot.deltaSasa.averagePrecisionLift.toFixed(3)}</TableCell>
              <TableCell className="mono-cell">{record.dockqDevelopmentPilot.deltaSasa.auroc.toFixed(3)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <Alert className="release-boundary-alert" role="note">
        <ReplayStatusIcon />
        <AlertTitle>
          {replayExecuted
            ? "Post-label regression replay passed—not new validation"
            : "Regression replay pending—not new validation"}
        </AlertTitle>
        <AlertDescription>
          {replayExecuted
            ? `From source commit ${record.dockqV05RegressionReplay.sourceCommit.slice(0, 12)}, all ${record.dockqV05RegressionReplay.poses} coordinates, non-SASA audits, DockQ records, and CAPRI labels passed; all ${record.dockqV05RegressionReplay.controlsAndCrossChecks} controls/cross-checks passed. Maximum ΔSASA drift was ${record.dockqV05RegressionReplay.maximumDeltaSasaAbsoluteDifferenceAngstrom2.toExponential(2)} Å² against a ${record.dockqV05RegressionReplay.deltaSasaToleranceAngstrom2.toExponential(0)} Å² bound. These labels were already observed, so this detects software regression but adds no independent performance evidence. The public context inventory still contains ${record.stateContextNativeRegression.sameVhhCrossContextPairs} same-VHH cross-context pairs, so state selectivity remains unvalidated.`
            : "The clean-tree replay has not been executed. No replay result is claimed. The public context inventory contains no same-VHH cross-context pairs, so state selectivity remains unvalidated."}
        </AlertDescription>
      </Alert>

      <Alert className="release-boundary-alert" role="note">
        <AlertTriangle />
        <AlertTitle>No holdout dataset exists for this release</AlertTitle>
        <AlertDescription>{record.holdoutStatus.statement}</AlertDescription>
      </Alert>
      </div>
    </details>
  );
}
