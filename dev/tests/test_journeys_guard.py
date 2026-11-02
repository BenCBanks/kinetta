"""Negative boundary checks use container metadata stand-ins, never a server."""
import copy
import unittest
from journeys_guard import ROOT, target


class Boundary(unittest.TestCase):
    def metadata(self):
        result = {}
        for service, destinations in [('app', ['/data', '/run/kinetta']), ('db', ['/var/lib/postgresql/data', '/run/kinetta'])]:
            result['kt-journeys-'+service+'-1'] = {
                'Config': {'Labels': {'com.docker.compose.project': 'kt-journeys', 'com.docker.compose.service': service,
                                     'com.docker.compose.project.working_dir': str(ROOT)},
                           'Env': ['KINETTA_JOURNEY_FIXTURE=1', 'FIT_DB_HOST=db']},
                'NetworkSettings': {'Ports': {'8000/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '8899'}]}},
                'Mounts': [{'Destination': name, 'Type': 'volume', 'Name': service+str(i)} for i, name in enumerate(destinations)]}
            for i in range(len(destinations)):
                result[service+str(i)] = {'Labels': {'com.docker.compose.project': 'kt-journeys'}}
        return result

    def test_accepts_only_matching_fixture(self):
        data = self.metadata()
        self.assertEqual(target('http://127.0.0.1:8899', 'kt-journeys', lambda kind, name: data[name]), ROOT)

    def test_rejects_untrusted_address_before_inspection(self):
        for base, project in [('https://example.invalid:8899', 'kt-journeys'), ('http://localhost:8899', 'kinetta'),
                              ('http://user@localhost:8899', 'kt-journeys'), ('http://@localhost:8899', 'kt-journeys'),
                              ('http://localhost:8899/path', 'kt-journeys'),
                              ('http://localhost:8899?target=x', 'kt-journeys'), ('http://localhost', 'kt-journeys')]:
            with self.subTest(base=base, project=project), self.assertRaises(ValueError):
                target(base, project, lambda *args: self.fail('Untrusted target reached Docker'))

    def test_rejects_mismatched_or_unmarked_deployment(self):
        original = self.metadata()
        changes = [lambda d: d['kt-journeys-app-1']['Config'].update(Env=['FIT_DB_HOST=db']),
                   lambda d: d['kt-journeys-app-1']['NetworkSettings']['Ports']['8000/tcp'][0].update(HostPort='8790'),
                   lambda d: d['kt-journeys-app-1']['NetworkSettings']['Ports']['8000/tcp'][0].update(HostIp='0.0.0.0'),
                   lambda d: d['kt-journeys-db-1']['Config']['Labels'].update({'com.docker.compose.project': 'other'}),
                   lambda d: d['kt-journeys-db-1']['Config']['Labels'].update({'com.docker.compose.project.working_dir': '/tmp/other-checkout'}),
                   lambda d: d['kt-journeys-app-1']['Mounts'][0].update(Type='bind'),
                   lambda d: d['db0']['Labels'].update({'com.docker.compose.project': 'other'})]
        for change in changes:
            data = copy.deepcopy(original); change(data)
            with self.subTest(change=changes.index(change)), self.assertRaises(ValueError):
                target('http://127.0.0.1:8899', 'kt-journeys', lambda kind, name: data[name])


unittest.main()
