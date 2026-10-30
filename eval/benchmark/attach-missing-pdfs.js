/*
 * Attach the open-access PDFs that Zotero could not find by itself for the
 * benchmark papers (publishers often block automatic downloads).
 *
 * Paste this whole file into Zotero: Tools → Developer → Run JavaScript, keep
 * "Run as async function" ticked, press Run. The result appears in the
 * "Return value" box. Then run export-from-zotero.js again.
 *
 * It only touches papers in the "Abbreviation benchmark" collections that are
 * listed below and still have no PDF. It adds the PDF as an attachment to that
 * paper and changes nothing else. Zotero rejects anything that is not a real
 * PDF, so a blocked download simply shows up as "not attached".
 *
 * Sources: Europe PMC's free copies where they exist, otherwise the
 * publisher's open-access PDF (or, for the 2017 paper, the authors'
 * university repository).
 */
const SOURCES = {
    // test
    '10.1021/acsomega.5c03570': ['https://europepmc.org/articles/PMC12368817?pdf=render'],
    '10.1063/5.0266243': ['https://europepmc.org/articles/PMC12283116?pdf=render'],
    '10.1016/j.isci.2025.112363': ['https://europepmc.org/articles/PMC12053632?pdf=render'],
    '10.1021/acscentsci.5c00939': ['https://europepmc.org/articles/PMC12550625?pdf=render'],
    '10.1242/bio.062018': ['https://europepmc.org/articles/PMC12570147?pdf=render'],
    '10.1080/19490976.2025.2600055': ['https://europepmc.org/articles/PMC12710938?pdf=render'],
    '10.1098/rsob.230270': ['https://europepmc.org/articles/PMC10932696?pdf=render'],
    '10.1515/nanoph-2024-0580': ['https://europepmc.org/articles/PMC12019952?pdf=render'],
    '10.1103/w4p6-b9mp': ['https://journals.aps.org/prx/pdf/10.1103/w4p6-b9mp'],
    // dev
    '10.1002/mnfr.201700403': ['https://pubblicazioni.unicam.it/bitstream/11581/401503/1/Bonaventura_et_al-2017-Molecular_Nutrition_%26_Food_Research.pdf'],
    '10.1186/s12915-026-02678-5': ['https://bmcbiol.biomedcentral.com/counter/pdf/10.1186/s12915-026-02678-5'],
    '10.1016/j.celrep.2024.114803': ['https://www.cell.com/action/showPdf?pii=S2211-1247(24)01154-9',
        'https://www.sciencedirect.com/science/article/pii/S2211124724011549/pdfft'],
    '10.1073/pnas.1301676110': ['https://europepmc.org/articles/PMC3732972?pdf=render',
        'https://www.pnas.org/content/pnas/110/31/E2895.full.pdf']
};

const MATCH = /abbrev\w*[\s\-–—_:]*benchmark/i;
const collections = Zotero.Collections.getByLibrary(Zotero.Libraries.userLibraryID, true)
    .filter(c => MATCH.test(c.name));
if (!collections.length) {
    return 'NOTHING DONE: no collection with "Abbreviation benchmark" in its name was found.';
}

const attached = [], failed = [], already = [];
for (const collection of collections) {
    for (const item of collection.getChildItems(false)) {
        if (!item.isRegularItem()) continue;
        const doi = String(item.getField('DOI') || '').trim().toLowerCase();
        const urls = SOURCES[doi];
        if (!urls) continue;
        const title = String(item.getField('title') || doi).replace(/<[^>]+>/g, '').slice(0, 80);

        let hasPDF = false;
        for (const id of item.getAttachments()) {
            const att = Zotero.Items.get(id);
            if (att && att.isPDFAttachment() && await att.fileExists()) { hasPDF = true; break; }
        }
        if (hasPDF) { already.push(title); continue; }

        let ok = false, why = '';
        for (const url of urls) {
            try {
                const att = await Zotero.Attachments.importFromURL({
                    libraryID: item.libraryID,
                    url,
                    parentItemID: item.id,
                    contentType: 'application/pdf',
                    title: 'Full Text PDF'
                });
                if (att && await att.fileExists()) { ok = true; break; }
            } catch (e) {
                why = (e && e.message) ? e.message : String(e);
            }
        }
        if (ok) attached.push(title);
        else failed.push(title + '\n      open https://doi.org/' + doi + ' in your browser, download the PDF and drag it onto the paper in Zotero'
            + (why ? '\n      (' + why.slice(0, 120) + ')' : ''));
    }
}

return 'PDFs attached: ' + attached.length
    + (attached.length ? '\n  - ' + attached.join('\n  - ') : '')
    + (already.length ? '\n\nAlready had a PDF: ' + already.length : '')
    + (failed.length ? '\n\nNot attached (' + failed.length + '), please do these by hand:\n  - ' + failed.join('\n  - ') : '')
    + '\n\nNow run export-from-zotero.js again.';
