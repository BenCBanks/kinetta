"""A mistaken target must be rejected before HTTP or SQL can touch it."""
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch
import guard


class Target(unittest.TestCase):
    def containers(self):
        root = str(Path(guard.__file__).resolve().parents[2])
        labels = {'com.docker.compose.project': 'kt-launch-load-test',
                  'com.docker.compose.project.working_dir': root}
        app = {'Config': {'Labels': dict(labels), 'Env': ['KINETTA_LOAD_FIXTURE=1', 'FIT_DB_HOST=db']},
               'NetworkSettings': {'Ports': {'8000/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '12345'}]}},
               'Mounts': [{'Type': 'volume', 'Name': 'fictional_data', 'Destination': '/data'},
                          {'Type': 'volume', 'Name': 'fictional_secrets', 'Destination': '/run/kinetta'}]}
        database = {'Config': {'Labels': {**labels, 'com.docker.compose.service': 'db'}},
                    'Mounts': [{'Type': 'volume', 'Name': 'fictional_db', 'Destination': '/var/lib/postgresql/data'},
                               {'Type': 'volume', 'Name': 'fictional_secrets', 'Destination': '/run/kinetta'}]}
        return app, database

    def check(self, app, database, volume_project='kt-launch-load-test'):
        def inspect(command):
            if command[1] == 'volume':
                return json.dumps([{'Labels': {'com.docker.compose.project': volume_project}}]).encode()
            return json.dumps([database if command[-1].endswith('-db-1') else app]).encode()
        with patch.object(guard.subprocess, 'check_output', side_effect=inspect), \
             patch.object(guard, 'urlopen', return_value=io.BytesIO(b'{"fictional_load_fixture":1}')) as http:
            result = guard.target('http://localhost:12345/', 'kt-launch-load-test')
            self.assertEqual(http.call_count, 1)
            return result

    def test_valid_fixture(self):
        self.assertEqual(self.check(*self.containers()), Path(guard.__file__).resolve().parents[2])

    def test_malformed_remote_or_unrelated_targets_never_reach_network(self):
        with patch.object(guard, 'urlopen') as http, patch.object(guard.subprocess, 'check_output') as docker:
            for base, project in [('https://example.invalid', 'kt-launch-load-test'),
                                  ('http://localhost:12345/path', 'kt-launch-load-test'),
                                  ('http://user@localhost:12345', 'kt-launch-load-test'),
                                  ('http://localhost:12345', 'unrelated'),
                                  ('http://localhost:12345?redirect=1', 'kt-launch-load-test')]:
                with self.assertRaises(ValueError): guard.target(base, project)
            http.assert_not_called(); docker.assert_not_called()

    def test_wrong_port_public_binding_checkout_database_and_borrowed_volume(self):
        for change in ('port', 'binding', 'checkout', 'database', 'connection', 'volume', 'bind'):
            app, database = self.containers()
            if change == 'port': app['NetworkSettings']['Ports']['8000/tcp'][0]['HostPort'] = '12346'
            if change == 'binding': app['NetworkSettings']['Ports']['8000/tcp'][0]['HostIp'] = '0.0.0.0'
            if change == 'checkout': app['Config']['Labels']['com.docker.compose.project.working_dir'] = '/unrelated'
            if change == 'database': database['Config']['Labels']['com.docker.compose.project'] = 'unrelated'
            if change == 'connection': app['Config']['Env'] = ['KINETTA_LOAD_FIXTURE=1', 'FIT_DB_HOST=unrelated']
            if change == 'bind': database['Mounts'][0]['Type'] = 'bind'
            with self.assertRaises(ValueError):
                self.check(app, database, 'unrelated' if change == 'volume' else 'kt-launch-load-test')


if __name__ == '__main__': unittest.main()
