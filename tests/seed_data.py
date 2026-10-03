"""Shared mock Supabase seed: Jake (admin), Ana (graded recording), Ben."""
JAKE, ANA, BEN = '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'
P = lambda h: h
SEED = {
  'users': [{'id': JAKE, 'email': 'jake@familychurch.org', 'password': 'jake-pass-123'},
            {'id': ANA, 'email': 'ana@familychurch.org', 'password': 'ana-pass-123'},
            {'id': BEN, 'email': 'ben@familychurch.org', 'password': None}],
  'profiles': [{'id': JAKE, 'email': 'jake@familychurch.org', 'display_name': 'Jake Labrador', 'role': 'admin', 'created_at': '2026-09-01T12:00:00Z'},
               {'id': ANA, 'email': 'ana@familychurch.org', 'display_name': 'Ana Rivera', 'role': 'preacher', 'created_at': '2026-09-02T12:00:00Z'},
               {'id': BEN, 'email': 'ben@familychurch.org', 'display_name': 'Ben Carter', 'role': 'preacher', 'created_at': '2026-09-03T12:00:00Z'}],
  'sermons': [
    {'id': 'ana-s1', 'user_id': ANA, 'title': 'Unshakable: Hebrews 12', 'content_html': '<h1>Unshakable</h1><p>Open to <strong>Hebrews 12:28</strong>. We receive a kingdom that cannot be shaken.</p><h2>1. What shakes us</h2><ul><li>Pressure</li><li>Comparison</li></ul><p>Read Psalm 46 with me.</p>',
     'timer_settings': {'minutes': 25}, 'last_position': 0, 'position_updated_at': None, 'updated_at': '2026-09-28T14:00:00Z', 'created_at': '2026-09-20T10:00:00Z', 'deleted': False, 'synced_at': '2026-09-28T14:00:01Z'},
    {'id': 'ben-s1', 'user_id': BEN, 'title': 'The Prodigal’s Brother', 'content_html': '<h1>The Prodigal’s Brother</h1><p>Luke 15:25-32 shows us the son who never left.</p>',
     'timer_settings': {'minutes': 30}, 'last_position': 0, 'position_updated_at': None, 'updated_at': '2026-09-30T18:00:00Z', 'created_at': '2026-09-25T10:00:00Z', 'deleted': False, 'synced_at': '2026-09-30T18:00:01Z'}],
  'recordings': [
    {'id': 'rec-ana-1', 'local_id': 'l-ana-1', 'user_id': ANA, 'sermon_id': 'ana-s1', 'sermon_title': 'Unshakable: Hebrews 12', 'speaker': 'Ana Rivera', 'notes': 'Was my second point clear?',
     'storage_path': f'{ANA}/ana-s1/2026-09-28T19-05-00-000Z.webm', 'mime_type': 'audio/webm', 'duration': 1712, 'overtime_seconds': 212, 'timer_minutes': 25,
     'created_at': '2026-09-28T19:05:00Z', 'status': 'graded',
     'transcript': 'Good evening, everybody. Go ahead and open your Bibles to Hebrews chapter twelve...\n\n(Transcript continues.)',
     'summary': 'Ana called students to build their lives on what cannot be shaken. Strong opening story; the second point needed a clearer transition and ran about 3.5 minutes long.',
     'grade_json': {'overall': 'B+', 'criteria': [{'name': 'Clarity of big idea', 'score': 9, 'max': 10, 'comment': 'Repeated three times, memorable.'},
                    {'name': 'Faithfulness to the text', 'score': 8, 'max': 10, 'comment': 'Good context for Hebrews 12.'},
                    {'name': 'Application', 'score': 7, 'max': 10, 'comment': 'Make one next step concrete.'},
                    {'name': 'Pacing / time', 'score': 6, 'max': 10, 'comment': '3:32 over a 25-minute slot.'}]}},
    {'id': 'rec-ben-1', 'local_id': 'l-ben-1', 'user_id': BEN, 'sermon_id': 'ben-s1', 'sermon_title': 'The Prodigal’s Brother', 'speaker': 'Ben Carter', 'notes': None,
     'storage_path': f'{BEN}/ben-s1/2026-09-30T23-10-00-000Z.m4a', 'mime_type': 'audio/mp4', 'duration': 1650, 'overtime_seconds': 0, 'timer_minutes': 30,
     'created_at': '2026-09-30T23:10:00Z', 'status': 'uploaded', 'transcript': None, 'summary': None, 'grade_json': None}],
  'objects': {f'{ANA}/ana-s1/2026-09-28T19-05-00-000Z.webm': {'size': 13000000, 'owner': ANA}, f'{BEN}/ben-s1/2026-09-30T23-10-00-000Z.m4a': {'size': 12500000, 'owner': BEN}},
}
