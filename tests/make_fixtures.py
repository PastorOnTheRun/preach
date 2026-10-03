"""Create test fixtures: a .docx (python-docx) and a .md sermon."""
import docx, pathlib
here = pathlib.Path(__file__).parent / 'fixtures'
d = docx.Document()
d.add_heading('The Good Shepherd', level=1)
d.add_heading('Point 1: He knows your name', level=2)
p = d.add_paragraph('Turn with me to John 10:11. ')
r = p.add_run('This is bold.'); r.bold = True
p.add_run(' And ')
r = p.add_run('this is italic.'); r.italic = True
d.add_paragraph('First list item referencing Psalm 23', style='List Bullet')
d.add_paragraph('Second list item referencing Isa 40:11', style='List Bullet')
d.add_paragraph('Numbered one', style='List Number')
d.add_paragraph('Numbered two', style='List Number')
d.save(here / 'test-sermon.docx')
(here / 'test-sermon.md').write_text('# Markdown Sermon\n\n**Bold** and *italic* with Rom 12:1-2.\n\n- one\n- two\n\n1. first\n2. second\n')
print('fixtures ok')
