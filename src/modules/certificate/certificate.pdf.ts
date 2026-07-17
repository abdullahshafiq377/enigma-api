import { Document, Page, renderToBuffer, StyleSheet, Text, View } from '@react-pdf/renderer';
import { createElement } from 'react';

const styles = StyleSheet.create({
  page: {
    padding: 60,
    fontFamily: 'Helvetica',
    color: '#0b3d5c',
    alignItems: 'center',
    justifyContent: 'center',
  },
  border: {
    borderWidth: 2,
    borderColor: '#0b3d5c',
    padding: 50,
    width: '100%',
    alignItems: 'center',
  },
  brand: { fontSize: 14, letterSpacing: 2, marginBottom: 24, color: '#5b6b7a' },
  title: { fontSize: 30, fontFamily: 'Helvetica-Bold', marginBottom: 24 },
  label: { fontSize: 12, color: '#5b6b7a' },
  name: { fontSize: 24, fontFamily: 'Helvetica-Bold', marginVertical: 12 },
  body: { fontSize: 14, marginVertical: 8, textAlign: 'center' },
  module: { fontSize: 18, fontFamily: 'Helvetica-Bold', marginTop: 4 },
  date: { fontSize: 12, color: '#5b6b7a', marginTop: 28 },
});

export interface CertificateData {
  recipientName: string;
  moduleTitle: string;
  dateStr: string;
}

/** Render a personalised completion certificate to a PDF Buffer (no JSX needed). */
export function buildCertificatePdf(data: CertificateData): Promise<Buffer> {
  const doc = createElement(
    Document,
    null,
    createElement(
      Page,
      { size: 'A4', orientation: 'landscape', style: styles.page },
      createElement(
        View,
        { style: styles.border },
        createElement(Text, { style: styles.brand }, 'ENIGMA UNIVERSITY'),
        createElement(Text, { style: styles.title }, 'Certificate of Completion'),
        createElement(Text, { style: styles.label }, 'This certifies that'),
        createElement(Text, { style: styles.name }, data.recipientName),
        createElement(Text, { style: styles.body }, 'has successfully completed'),
        createElement(Text, { style: styles.module }, data.moduleTitle),
        createElement(Text, { style: styles.date }, `Issued ${data.dateStr}`),
      ),
    ),
  );
  return renderToBuffer(doc);
}
