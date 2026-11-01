"""Check actual Simulator tab headers against UIKit, rather than fabricated CSS insets."""


def check_headers(rows):
    pages = {'me', 'activity', 'track', 'progress', 'food'}
    assert len(rows) == 5 and {row['topBand']['page'] for row in rows} == pages
    titles = []
    for row in rows:
        label = (row['device'], row['theme'], row['stage'])
        native, band = row['uikit'], row['topBand']
        window, web = native['window'], native['webView']
        safe = native['safeTop']
        assert safe >= 20 and abs(row['safeTop'] - safe) <= 1, label
        assert native['statusBar']['y'] + native['statusBar']['height'] <= safe + 1, label
        for key in ('x', 'y', 'width', 'height'):
            assert abs(web[key] - window[key]) <= 1, (label, key, native)
        for key in ('scrollAdjustedTop', 'scrollContentTop', 'scrollOffsetY'):
            assert abs(native[key]) <= 1, (label, key, native)
        assert abs(row['viewport']['width'] - web['width']) <= 1, label
        assert abs(row['viewport']['height'] - web['height']) <= 1, label
        assert abs(band['shellPaddingTop'] - safe) <= 1, (label, band)
        assert abs(band['header']['y'] - safe) <= 1, (label, band)
        assert 0 <= band['title']['y'] - safe <= 10, (label, band)
        assert band['glyph']['y'] >= safe - 1, (label, band)
        assert band['controls'], label
        for control in band['controls']:
            assert control['width'] >= 44 and control['height'] >= 44, (label, control)
            assert control['y'] >= safe - 1, (label, control)
        titles.append(band['title']['y'])
    assert max(titles) - min(titles) <= 2, ('Five tab titles must align within 2pt', titles)
