/*
 * Export the benchmark papers' text from Zotero.
 *
 * Paste this whole file into Zotero: Tools → Developer → Run JavaScript,
 * keep "Run as async function" TICKED, then press Run. The result appears in
 * the "Return value" box on the right when it has finished (40 papers take
 * about a minute).
 *
 * What it does
 *   - Finds every collection in My Library whose name contains "Abbreviation
 *     benchmark" (for example "Abbreviation benchmark - test" and
 *     "Abbreviation benchmark - dev"; capitals and dashes do not matter).
 *   - For each paper in them, takes its PDF and asks Zotero's own PDF worker
 *     for the text: exactly the text the plugin sees when you read the paper.
 *   - Saves one .txt file per paper, plus papers.json (title, DOI, journal,
 *     …) and missing.txt (papers without a PDF), in
 *       <Zotero data directory>/abbreviation-benchmark/<test|dev|…>/
 *     and opens that folder in the Finder when it is done.
 *
 * It only reads your library. Nothing in Zotero is added, changed or deleted.
 * Running it again overwrites the previous export.
 *
 * Text format: pages are separated by a form feed (\f). The plugin turns
 * these into spaces before detecting abbreviations; the benchmark does the
 * same.
 */
const MATCH = /abbrev\w*[\s\-–—_:]*benchmark/i;
const libraryID = Zotero.Libraries.userLibraryID;
const all = Zotero.Collections.getByLibrary(libraryID, true);
const collections = all.filter(c => MATCH.test(c.name));
const root = PathUtils.join(Zotero.DataDirectory.dir, 'abbreviation-benchmark');

if (!collections.length) {
    return 'NOTHING EXPORTED: no collection with "Abbreviation benchmark" in its name was found in My Library.\n\n'
        + 'Your collections are:\n  ' + (all.map(c => c.name).sort().join('\n  ') || '(none)') + '\n\n'
        + 'Rename the two collections to "Abbreviation benchmark - test" and "Abbreviation benchmark - dev", then run this again.';
}

const report = [];
for (const collection of collections) {
    // "Abbreviation benchmark - test" → "test"
    const subset = collection.name.replace(MATCH, '').replace(/^[\s\-–—:_]+|[\s\-–—:_]+$/g, '')
        .replace(/[^A-Za-z0-9_-]+/g, '-').toLowerCase() || 'papers';
    const dir = PathUtils.join(root, subset);
    await IOUtils.makeDirectory(dir, { createAncestors: true, ignoreExisting: true });

    const papers = [];
    const missing = [];
    const items = collection.getChildItems(false).filter(it => it.isRegularItem() || it.isPDFAttachment());
    for (const item of items) {
        const field = (name) => { try { return item.getField(name) || ''; } catch (e) { return ''; } };
        const title = field('title') || '(untitled)';
        let pdf = null;
        if (item.isPDFAttachment()) {
            pdf = item;
        } else {
            const best = await item.getBestAttachment();
            if (best && best.isPDFAttachment()) pdf = best;
            if (!pdf) {
                for (const id of item.getAttachments()) {
                    const att = Zotero.Items.get(id);
                    if (att && att.isPDFAttachment()) { pdf = att; break; }
                }
            }
        }
        if (!pdf || !(await pdf.fileExists())) {
            missing.push(title + (field('DOI') ? '  (DOI ' + field('DOI') + ')' : ''));
            continue;
        }

        let result = null;
        try {
            result = await Zotero.PDFWorker.getFullText(pdf.id, null, true);
        } catch (e) {
            missing.push(title + '  (text could not be extracted: ' + e.message + ')');
            continue;
        }
        const text = (result && typeof result.text === 'string') ? result.text : '';
        const file = item.key + '.txt';
        await IOUtils.writeUTF8(PathUtils.join(dir, file), text);
        papers.push({
            file,
            itemKey: item.key,
            attachmentKey: pdf.key,
            title,
            doi: field('DOI'),
            archiveID: field('archiveID'),
            journal: field('publicationTitle') || field('repository'),
            publisher: field('publisher'),
            year: (field('date').match(/\d{4}/) || [''])[0],
            itemType: Zotero.ItemTypes.getName(item.itemTypeID),
            url: field('url'),
            pages: result ? result.totalPages : null,
            extractedPages: result ? result.extractedPages : null,
            characters: text.length
        });
    }

    await IOUtils.writeUTF8(PathUtils.join(dir, 'papers.json'), JSON.stringify({
        collection: collection.name,
        exported: new Date().toISOString(),
        zoteroVersion: Zotero.version,
        papers
    }, null, 2));
    await IOUtils.writeUTF8(PathUtils.join(dir, 'missing.txt'), missing.length ? missing.join('\n') + '\n' : '');
    report.push('"' + collection.name + '" → folder "' + subset + '": ' + items.length + ' papers, '
        + papers.length + ' exported'
        + (missing.length ? ', ' + missing.length + ' without a usable PDF:\n    - ' + missing.join('\n    - ') : ''));
}

try { await Zotero.File.reveal(root); } catch (e) {}
return 'DONE. Saved in:\n' + root + '\n\n' + report.join('\n\n')
    + (report.some(r => r.includes('without a usable PDF'))
        ? '\n\nFor papers without a PDF: right-click the paper → Find Full Text, or drag the PDF onto it, then run this again.'
        : '');
