import { Button, Text } from '@react-email/components';
import { button, EmailLayout, heading, text } from '../components/EmailLayout';
import type { IncidentReportedProps } from '../types';

// To management the moment a serious incident is filed — severe or critical,
// or anything that called EMS or the police. Everything needed to decide
// whether to drive in is in the body; the link is for the full report,
// photos, and the follow-up thread.

const detailRow = {
  ...text,
  margin: '0 0 4px',
};

const quote = {
  ...text,
  borderLeft: '3px solid #d15232',
  paddingLeft: '12px',
  fontStyle: 'italic' as const,
};

export function IncidentReported({
  reference,
  severityLabel,
  categoryLabel,
  areaLabel,
  occurredLabel,
  reportedByLabel,
  description,
  immediateActions,
  injuredCount,
  emsCalled,
  incidentUrl,
}: IncidentReportedProps) {
  const injuredLine =
    injuredCount === 0
      ? 'Nobody recorded as injured'
      : `${injuredCount} ${injuredCount === 1 ? 'person' : 'people'} recorded as injured`;

  return (
    <EmailLayout preview={`${severityLabel} incident at Pyre: ${categoryLabel} (${reference})`}>
      <Text style={heading}>
        {severityLabel} incident — {categoryLabel}
      </Text>
      <Text style={text}>
        {reportedByLabel} filed report {reference}.
      </Text>

      <Text style={detailRow}>
        <strong>When:</strong> {occurredLabel}
      </Text>
      <Text style={detailRow}>
        <strong>Where:</strong> {areaLabel}
      </Text>
      <Text style={detailRow}>
        <strong>People:</strong> {injuredLine}
      </Text>
      <Text style={{ ...detailRow, margin: '0 0 16px' }}>
        <strong>EMS:</strong> {emsCalled ? 'Called' : 'Not called'}
      </Text>

      <Text style={quote}>{description}</Text>

      <Text style={text}>
        <strong>What staff did:</strong> {immediateActions}
      </Text>

      <Button style={button} href={incidentUrl}>
        Open the full report
      </Button>
    </EmailLayout>
  );
}

IncidentReported.PreviewProps = {
  reference: 'INC-2026-0042',
  severityLabel: 'Severe',
  categoryLabel: 'Burn',
  areaLabel: 'Sauna',
  occurredLabel: 'Tuesday, August 21 at 7:42 PM',
  reportedByLabel: 'Sunny',
  description:
    'Guest reached over the stove to add water and touched the rock cage with the back of their right hand. Skin reddened immediately with a small blister forming.',
  immediateActions:
    'Moved them to the lounge, ran cool water over the hand for 15 minutes, applied a loose sterile dressing from the front-desk kit. They declined an ambulance and a partner drove them to urgent care.',
  injuredCount: 1,
  emsCalled: false,
  incidentUrl:
    'https://pyre-integrations.vercel.app/admin/incidents/2f0a0c6e-0000-4000-8000-000000000000',
} satisfies IncidentReportedProps;

export default IncidentReported;
