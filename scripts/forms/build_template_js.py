"""forms/templates/<id>.hwpx → forms/<id>.template.js (file:// 에서도 열리도록 base64로 포함)

사용: python scripts/forms/build_template_js.py campaign-plan
"""
import base64, os, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
form_id = sys.argv[1]
src = os.path.join(ROOT, 'output', 'web', 'forms', 'templates', form_id + '.hwpx')
dst = os.path.join(ROOT, 'output', 'web', 'forms', form_id + '.template.js')
b64 = base64.b64encode(open(src, 'rb').read()).decode('ascii')
with open(dst, 'w', encoding='utf-8', newline='\n') as f:
    f.write('// 자동 생성: scripts/forms/build_template_js.py %s — 직접 수정하지 마세요.\n' % form_id)
    f.write('window.DR_FORM_TEMPLATES = window.DR_FORM_TEMPLATES || {};\n')
    f.write("window.DR_FORM_TEMPLATES['%s'] = '%s';\n" % (form_id, b64))
print(dst, len(b64))
