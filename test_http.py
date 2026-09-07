import json
import subprocess
import sys
import tempfile
import unittest
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parent


class RestartProof(unittest.TestCase):
    def test_commit_survives_process_kill_and_browser_replacement(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory)/'world.sqlite3'
            def start():
                process = subprocess.Popen([sys.executable, str(ROOT/'server.py'), '--port', '0', '--db', str(database)],
                                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                def cleanup():
                    if process.poll() is None:
                        process.kill()
                    process.wait(timeout=5)
                    process.stdout.close(); process.stderr.close()
                self.addCleanup(cleanup)
                line = process.stdout.readline().strip()
                self.assertTrue(line.startswith('Red Door: http://127.0.0.1:'), line)
                return process, line.split('Red Door: ')[1]
            def get(url):
                with urllib.request.urlopen(url, timeout=5) as response:
                    return json.load(response)
            process, base = start()
            first = get(base+'/api/world')['world']
            payload = {'request_id':'restart-proof','expected_revision':0,'command':'woods'}
            def post(origin):
                request = urllib.request.Request(base+'/api/commands', data=json.dumps(payload).encode(),
                    headers={'Content-Type':'application/json','Origin':origin})
                return urllib.request.urlopen(request,timeout=5)
            with self.assertRaises(urllib.error.HTTPError) as denied:
                post('https://unrelated.example')
            self.assertEqual(denied.exception.code,403)
            with post(base) as response:
                receipt=json.load(response)['receipt']
            self.assertEqual(receipt['state']['location'], 'woods_edge')
            self.assertEqual(get(base+'/api/terminal')['world'], receipt)
            with post(base) as response:
                self.assertEqual(json.load(response)['receipt'], receipt)
            payload['state'] = {'inventory':['forged coin']}
            with self.assertRaises(urllib.error.HTTPError) as forged:
                post(base)
            self.assertEqual(forged.exception.code, 400)
            process.kill(); process.wait(timeout=5)
            process.stdout.close(); process.stderr.close()
            restarted, new_base = start()
            recovered=get(new_base+'/api/world')['world']
            self.assertEqual(recovered,receipt)
            self.assertEqual(get(new_base+'/api/verify')['receipts'],2)
            restarted.terminate(); restarted.wait(timeout=5)
            restarted.stdout.close(); restarted.stderr.close()


if __name__ == '__main__':
    unittest.main()
