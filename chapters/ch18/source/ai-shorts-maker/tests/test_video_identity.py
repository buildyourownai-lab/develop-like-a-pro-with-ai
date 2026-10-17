from __future__ import annotations
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[1]

def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

PUBLISHER = load('identity_publisher', 'upload_private_video.py')
REVIEWER = load('identity_reviewer', 'review_video.py')

class IdentityTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.video = self.root / 'video.mp4'
        self.video.write_bytes(b'file A')
        self.qa = self.root / 'qa.json'
        self.plan = json.loads((ROOT / 'prototypes/youtube-shorts/chapter-18/upload-plan.json').read_text(encoding="utf-8"))
        self.plan.update(channel_handle='@my-channel', video=str(self.video),
                         video_sha256=PUBLISHER.sha256(self.video), qa_report=str(self.qa))

    def qa_payload(self, digest):
        self.qa.write_text(json.dumps({'status':'PASS', 'gate':'UPLOAD READY', 'video_sha256':digest}), encoding="utf-8")

    def test_same_qa_file_identity_passes(self):
        self.qa_payload(self.plan['video_sha256'])
        self.assertEqual(PUBLISHER.validate_plan(self.plan)[1], self.plan['video_sha256'])

    def test_different_or_missing_qa_identity_blocks(self):
        for digest in ['0'*64, None]:
            with self.subTest(digest=digest):
                self.qa_payload(digest)
                with self.assertRaisesRegex(ValueError, 'report video SHA-256'):
                    PUBLISHER.validate_plan(self.plan)

    def test_video_changed_after_review_blocks(self):
        self.qa_payload(self.plan['video_sha256'])
        self.video.write_bytes(b'file B')
        with self.assertRaisesRegex(ValueError, 'video SHA-256 mismatch'):
            PUBLISHER.validate_plan(self.plan)

    def test_unconfigured_template_blocks(self):
        self.plan['channel_handle']='@YOUR_CHANNEL_HANDLE'
        with self.assertRaisesRegex(ValueError, 'own channel'):
            PUBLISHER.validate_plan(self.plan)

    def test_visual_review_bound_to_video_contact_sheet_and_policy(self):
        policy=ROOT/'prototypes/youtube-shorts/chapter-17/review-policy.json'
        contact=self.root/'contact.png'
        contact.write_bytes(b'observed frames')
        rules=json.loads(policy.read_text(encoding="utf-8"))
        payload={'reviewer':'test fixture', 'video_sha256':REVIEWER.sha256(self.video),
                 'policy_sha256':REVIEWER.sha256(policy),
                 'contact_sheet_sha256':REVIEWER.sha256(contact),
                 'judgments':{name:True for name in rules['required_visual_judgments']}}
        visual=self.root/'visual.json'
        metadata={'format':{'duration':'47.624'},'streams':[
            {'codec_type':'video','codec_name':'h264','width':1080,'height':1920},
            {'codec_type':'audio','codec_name':'aac'}]}
        with patch.object(REVIEWER,'probe',return_value=metadata), \
             patch.object(REVIEWER,'run',return_value=MagicMock(returncode=0,stderr='')), \
             patch.object(REVIEWER,'audio_mean_volume',return_value=-20), \
             patch.object(REVIEWER,'detect_black',return_value=([],'')), \
             patch.object(REVIEWER,'make_contact_sheet',side_effect=lambda v,c:c.write_bytes(b'observed frames')):
            for field in [None,'video_sha256','contact_sheet_sha256','policy_sha256']:
                with self.subTest(field=field):
                    copy=dict(payload)
                    if field: copy[field]='0'*64
                    visual.write_text(json.dumps(copy), encoding="utf-8")
                    result=REVIEWER.review_video(self.video,policy,self.root/'qa-out.json',contact,visual)
                    self.assertEqual(result['gate'], 'NOT READY' if field else 'UPLOAD READY')
                    self.assertEqual(result['video_sha256'], REVIEWER.sha256(self.video))

    def test_status_update_preserves_synthetic_flag_from_platform(self):
        service=MagicMock()
        service.videos().list().execute.return_value={'items':[{'status':{'containsSyntheticMedia':True}}]}
        PUBLISHER.change_video_status(service,'same-id','public',False)
        status=service.videos().update.call_args.kwargs['body']['status']
        self.assertIs(status['containsSyntheticMedia'],True)
        self.assertEqual(status['privacyStatus'],'public')

    def test_explicit_synthetic_flag_requires_no_platform_lookup(self):
        service=MagicMock()
        PUBLISHER.change_video_status(service,'same-id','public',False,False)
        service.videos().list.assert_not_called()
        self.assertIs(service.videos().update.call_args.kwargs['body']['status']['containsSyntheticMedia'],False)

if __name__=='__main__': unittest.main()
