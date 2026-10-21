import React from 'react';
import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';
import { terms as T } from '../lib/engine.js';
import { LOADS, positionLabel, mapPosition } from '../lib/planModel.js';
import { meetingText, listText } from '../lib/format.js';

const BLUE = '#0266BB';
const INK = '#14202E';
const GRAY = '#566579';
const LINE = '#D3DCE7';

const s = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 58, paddingHorizontal: 44, fontFamily: 'Helvetica', fontSize: 10, color: INK, lineHeight: 1.35 },
  header: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 2, borderBottomColor: BLUE, paddingBottom: 10, marginBottom: 14 },
  logo: { width: 62, height: 48, marginRight: 12 },
  dept: { fontSize: 13, fontFamily: 'Helvetica-Bold' },
  prog: { fontSize: 10.5, color: GRAY },
  title: { fontSize: 20, lineHeight: 1.2, fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  meta: { fontSize: 10, color: GRAY, marginBottom: 2 },
  prepared: { fontSize: 11, marginTop: 4, fontFamily: 'Helvetica-Bold' },
  summary: { flexDirection: 'row', marginTop: 12, marginBottom: 4, borderWidth: 1, borderColor: LINE },
  cell: { flex: 1, padding: 8, borderRightWidth: 1, borderRightColor: LINE },
  cellLast: { flex: 1, padding: 8 },
  cellLabel: { fontSize: 8.5, lineHeight: 1.3, color: GRAY, marginBottom: 3 },
  cellValue: { fontSize: 15, lineHeight: 1.25, fontFamily: 'Helvetica-Bold', color: BLUE, marginBottom: 3 },
  cellNote: { fontSize: 8.5, lineHeight: 1.3, color: GRAY },
  h2: { fontSize: 12.5, fontFamily: 'Helvetica-Bold', color: BLUE, marginTop: 14, marginBottom: 5 },
  row: { flexDirection: 'row', marginBottom: 3 },
  key: { width: 118, color: GRAY },
  val: { flex: 1 },
  tHead: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: INK, paddingBottom: 3, fontFamily: 'Helvetica-Bold', fontSize: 9 },
  tRow: { flexDirection: 'row', borderBottomWidth: 0.75, borderBottomColor: LINE, paddingVertical: 4 },
  tRowSenior: { backgroundColor: '#E3EEF9' },
  c1: { width: 78, fontFamily: 'Helvetica-Bold' },
  c2: { flex: 1, paddingRight: 8 },
  c3: { width: 40, textAlign: 'right' },
  c4: { width: 74, textAlign: 'right' },
  senior: { fontFamily: 'Helvetica-Bold', color: BLUE },
  bullet: { flexDirection: 'row', marginBottom: 3 },
  bulletMark: { width: 10 },
  bulletText: { flex: 1 },
  small: { fontSize: 9, color: GRAY },
  footer: { position: 'absolute', left: 44, right: 44, bottom: 24, height: 22, borderTopWidth: 0.75, borderTopColor: LINE, paddingTop: 6, flexDirection: 'row', justifyContent: 'space-between' },
  footText: { fontSize: 8.5, color: GRAY },
});

const STATUS_TEXT = { 'on-track': 'On track', attention: 'Needs attention', delayed: 'Delayed' };

function Bullet({ children }) {
  return (
    <View style={s.bullet} wrap={false}>
      <Text style={s.bulletMark}>-</Text>
      <Text style={s.bulletText}>{children}</Text>
    </View>
  );
}

export default function PlanPdf({ catalog, answers, result, name, logo, created, classTimes }) {
  const position = mapPosition(answers);
  const where = answers.firstSemester
    ? `Starting in ${T.termLabel(result.currentTerm)}`
    : `${T.termLabel(result.currentTerm)} (${positionLabel(position)})`;
  const finished = answers.finished.map((id) => id);
  const sd = result.seniorDesign;
  const rows = [...(result.inProgress ? [{ ...result.inProgress, inProgress: true }] : []), ...result.terms];
  const option = classTimes?.option ?? null;

  return (
    <Document title="Mechatronics Engineering Degree Plan" author="Mechatronics Degree Planner" subject="Catalog year 2026-27">
      <Page size="LETTER" style={s.page}>
        <View style={s.header}>
          {logo ? <Image src={logo} style={s.logo} /> : null}
          <View>
            <Text style={s.dept}>Department of Engineering &amp; Technology</Text>
            <Text style={s.prog}>Mechatronics Engineering</Text>
          </View>
        </View>

        <Text style={s.title}>Mechatronics Engineering Degree Plan</Text>
        <Text style={s.meta}>Created {created}. Catalog year 2026-27.</Text>
        {name ? <Text style={s.prepared}>Prepared for: {name}</Text> : null}

        <View style={s.summary}>
          <View style={s.cell}>
            <Text style={s.cellLabel}>You graduate</Text>
            <Text style={s.cellValue}>{result.graduationLabel ?? 'Not yet known'}</Text>
            <Text style={s.cellNote}>Status: {STATUS_TEXT[result.status]}</Text>
          </View>
          <View style={s.cell}>
            <Text style={s.cellLabel}>Senior design starts</Text>
            <Text style={s.cellValue}>{sd ? sd.startLabel : 'Not yet known'}</Text>
            <Text style={s.cellNote}>{sd ? `ENGR 4580, then ENGR 4590 in ${sd.endLabel}` : ''}</Text>
          </View>
          <View style={s.cellLast}>
            <Text style={s.cellLabel}>Credit load</Text>
            <Text style={s.cellValue}>{LOADS[result.loadKey].label}</Text>
            <Text style={s.cellNote}>{LOADS[result.loadKey].range} a semester</Text>
          </View>
        </View>

        <Text style={s.h2}>Your answers</Text>
        <View style={s.row}><Text style={s.key}>{answers.firstSemester ? 'First semester' : 'Current semester'}</Text><Text style={s.val}>{where}</Text></View>
        <View style={s.row}>
          <Text style={s.key}>Finished courses</Text>
          <Text style={s.val}>{finished.length ? finished.join(', ') : 'None'}</Text>
        </View>
        {!answers.firstSemester && (
          <View style={s.row}>
            <Text style={s.key}>Taking this semester</Text>
            <Text style={s.val}>{answers.taking.length ? answers.taking.join(', ') : 'None'}</Text>
          </View>
        )}
        <View style={s.row}><Text style={s.key}>Electives</Text><Text style={s.val}>{result.electives.length ? result.electives.map((id) => `${id} ${catalog.courses[id].title}`).join('; ') : 'None'}</Text></View>
        <View style={s.row}><Text style={s.key}>Credit load</Text><Text style={s.val}>{LOADS[result.loadKey].label}, {LOADS[result.loadKey].range} a semester</Text></View>

        <Text style={s.h2}>Semester by semester</Text>
        <View style={s.tHead}>
          <Text style={s.c1}>Semester</Text>
          <Text style={s.c2}>Courses</Text>
          <Text style={s.c3}>Hours</Text>
          <Text style={s.c4}>Open hours</Text>
        </View>
        {rows.map((t) => {
          const hasSenior = t.courses.some((c) => c.kind === 'senior-design');
          return (
            <View key={t.term} style={hasSenior ? [s.tRow, s.tRowSenior] : s.tRow} wrap={false}>
              <Text style={s.c1}>{t.label}{t.inProgress ? '\n(in progress)' : ''}</Text>
              <View style={s.c2}>
                {t.courses.map((c) => (
                  <Text key={c.course} style={c.kind === 'senior-design' ? s.senior : undefined}>
                    {c.course} {c.title}{c.kind === 'senior-design' ? ' (senior design)' : ''}, {c.credits} hr
                  </Text>
                ))}
              </View>
              <Text style={s.c3}>{t.hours}</Text>
              <Text style={s.c4}>{t.inProgress ? '' : `${t.open} hr`}</Text>
            </View>
          );
        })}
        <Text style={[s.small, { marginTop: 5 }]}>
          Open hours are left for general education courses. This plan does not schedule them.
          {result.genEd.remaining > 0 ? ` You still need about ${result.genEd.remaining} hours of general education. The plan leaves ${result.genEd.open} open hours.` : ''}
        </Text>

        {result.alerts.length > 0 && (
          <View>
            <Text style={s.h2}>Things to know</Text>
            {result.alerts.map((a) => <Bullet key={a.text}>{a.text}</Bullet>)}
          </View>
        )}

        {classTimes && (
          <View>
            <Text style={s.h2} minPresenceAhead={50}>Class times for {T.termLabel(classTimes.term)}</Text>
            {classTimes.used && classTimes.used !== classTimes.term && (
              <Text style={[s.small, { marginBottom: 4 }]}>
                {T.termLabel(classTimes.term)} classes are not published yet. These times come from {T.termLabel(classTimes.used)} and may change.
              </Text>
            )}
            {option ? option.choices.map((c) => (
              <Bullet key={c.crn}>
                {c.course} {c.title}{c.component !== c.course ? ` (${c.component})` : ''}: section {c.section}, {c.meetings.length ? c.meetings.map(meetingText).join('; ') : (c.online ? 'online, no set time' : 'time to be announced')}
              </Bullet>
            )) : <Text>No class times are available for this semester yet.</Text>}
            {classTimes.noSections?.length > 0 && (
              <Text style={s.small}>No sections found for: {listText(classTimes.noSections.map((n) => n.course))}.</Text>
            )}
          </View>
        )}

        <View style={s.footer} fixed>
          <Text style={s.footText}>Student-built planning tool. Confirm your plan with your academic advisor.</Text>
        </View>
      </Page>
    </Document>
  );
}
