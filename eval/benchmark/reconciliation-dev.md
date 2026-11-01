# Reconciliation log - dev set

Step 2 of the labelling process (see GUIDELINES.md): after the blind pass the
detector was run once and every disagreement was re-checked against the paper.
Only the changes below were made. Nothing was changed to flatter the detector:
the 35 remaining false positives are left standing, and all but two of them
come from one paper whose author block the detector misreads (see the bottom
of this file).

Entries added here carry `"recon": true`, so glossary recall can be reported
with and without them.

## Definitions the blind pass missed

The blind pass read a truncated candidate list for a few papers, so real
definitions further down the list were not labelled. Each was re-checked in
the text before being added.

- 10.64898/2025.12.01.691077: defined += CST = Cell Signaling Technology  (antibody-table footnote key: "CST = Cell Signaling Technology (Danvers, MA, USA)")
- 10.64898/2025.12.01.691077: defined += TFS = Thermo Fisher Scientific  (same footnote key)
- 10.1126/sciadv.abf4459: defined += THF = tetrahydrofolate
- 10.1126/sciadv.abf4459: defined += TGEV = transmissible gastroenteritis coronavirus
- 10.1126/sciadv.abf4459: defined += gRNA = genomic RNA
- 10.1126/sciadv.abf4459: defined += sgmRNA = subgenomic mRNA  (written out as "subgenomic N protein mRNA synthesis" before the short form is used)
- 10.1126/sciadv.abf4459: defined += NEB = New England Biolabs
- 10.1126/sciadv.abf4459: defined += PCR = polymerase chain reaction
- 10.1126/sciadv.abf4459: defined += PAGE = polyacrylamide gel electrophoresis
- 10.1126/sciadv.abf4459: defined += TBE = tris-borate EDTA
- 10.1126/sciadv.abf4459: defined += rRNA = ribosomal RNA  ("16S ribosomal RNA (rRNA; Fig. 9F)")
- 10.7554/eLife.81856: defined += FBS = fetal bovine serum
- 10.1038/s44318-025-00615-w: defined += Ub = ubiquitin
- 10.1038/s41563-021-01020-4: defined += Ab = antibody
- 10.1038/s41598-026-40706-0: defined += Gluc = Gaussia luciferase
- 10.1038/s41598-026-40706-0: defined += SEAP = secreted Alkaline Phosphatase
- 10.1038/s41598-026-40706-0: defined += dPCR = digital PCR
- 10.1016/j.jbc.2024.107846: defined += LoKI = Local kinase inhibitors

## Standard abbreviations the papers never spell out

Used at least twice standalone, standard in the field, never defined.

- 10.64898/2025.12.01.691077: ANOVA, BSA, EMT, PBS, WB, cDNA, lncRNA
- 10.7554/eLife.81856: EGFP, HEPES, RPMI
- 10.1016/j.celrep.2024.114803: NADH, SDS-PAGE, rRNA
- 10.1038/s41467-021-24194-6: LC-MS, MS
- 10.1093/nar/gkae282: HEPES
- 10.1126/sciadv.abf4459: EDTA, mRNA
- 10.1073/pnas.1301676110: SD
- 10.3390/foods9111678: MS
- 10.1038/s41598-026-40706-0: DMEM, PCR, cDNA
- 10.7554/eLife.83853: ANOVA, BSA, HEPES, ncRNA, rRNA, tRNA
- 10.1038/s41565-023-01321-6: TEM

## Ignore categories the blind pass missed

- 10.64898/2025.12.01.691077: DAP, TTFields  (appear only in the reference list)
- 10.1016/j.celrep.2024.114803: SEC  (not an abbreviation: "SECOND STAGE" split by the figure's text extraction)
- 10.1371/journal.pgen.1010901: ADL, EBC  (used once only)
- 10.1038/s41598-026-40706-0: IP  (only ever inside the product name "miRNA Target IP kit")
- 10.1038/s41598-026-40706-0: UMIs, DEJ  (used once only)
- 10.7554/eLife.83853: MAPK, ROI, siRNA  (used once only)
- 10.7554/eLife.81856: tRNA  (used once only)
- 10.1126/sciadv.abf4459: EMS  (used once only)
- 10.1101/2023.12.01.569403: ATP  (used once only)
- 10.3390/biom14020176: ChIP  (used once only)

## Left standing: a detector defect, not a labelling gap

33 of the 35 remaining false positives come from 10.64898/2025.12.01.691077, whose text begins
with a semicolon-separated author and affiliation block ("Authors: … ;
Affiliations: 1University of Ljubljana; Faculty of Medicine; …"). The detector
reads those semicolons as an abbreviation list and returns author names and
institutions as abbreviations ("Alja", "Sergej", "Faculty", "Slovenia"), along
with fragments of numbered citations ("28).", "44).", "24]”"). The same paper
also produces one runaway long form for PDK1 that swallows the whole author
block. These are defects to fix in the list and glossary phases, so they stay
counted against precision.

The other two are PD and a single-use abbreviation, both correctly outside the
labels.

## Scoring note

Nothing in the scorer was changed for the dev set beyond matching a paper
with no DOI and no arXiv ID in the library by its title, so it is scored
instead of being skipped.

## Second pass (detector rewrite)

After the detector was rewritten, its new disagreements on dev were checked
against the text the same way. The same pass also re-applied the
guidelines to every label it touched: definitions that only occur in the
reference list or acknowledgements, and short forms used once, belong in
`ignore`. Test labels were not touched.

### Definitions the earlier passes missed

- 10.1007/978-3-319-11295-4_1: defined += 3D = three-dimensional
- 10.1038/s41557-021-00679-1: defined += 3D = three-dimensional
- 10.1038/s41563-021-01020-4: defined += 3D = three-dimensional
- 10.1038/s41563-021-01020-4: defined += 2D = two-dimensional
- 10.1038/s41563-021-01020-4: defined += VP = virus particles
- 10.1038/s41563-025-02418-0: defined += 3D = three-dimensional
- 10.1038/s41563-025-02418-0: defined += 2D = two-dimensional
- 10.1038/s41565-023-01321-6: defined += 3D = three-dimensional
- 10.1038/s41565-023-01321-6: defined += 2D = two-dimensional
- 10.1038/s41565-023-01321-6: defined += GSFSC = GoldStandard Fourier Shell Correlation  (table header)
- 10.1073/pnas.2207902119: defined += 2D = two-dimensional
- 10.1126/sciadv.abf4459: defined += 2D = two-dimensional
- 10.1126/sciadv.abf4459: defined += c-di-GMP = bis-(3′-5′)-cyclic dimeric guanosine monophosphate  (c-di-GMP [long form])
- 10.1126/science.1253920: defined += 4H = four-helix
- 10.1126/science.1253920: defined += 6H = six-helix
- 10.1021/acsnano.0c07696: defined += 1D = one-dimensional  ("onedimensional" in the extracted text)
- 10.1021/acsnano.0c07696: defined += nt = nucleotide
- 10.1016/j.celrep.2024.114803: defined += TCEP = Tris (2-carboxyethyl) phosphine hydrochloride  (key resources table and methods)
- 10.1016/j.celrep.2024.114803: defined += CHX = Cyclohexamide  (key resources table; the paper misspells cycloheximide)
- 10.1016/j.celrep.2024.114803: defined += DMEM = Dulbecco's modified Eagle's medium
- 10.1016/j.celrep.2024.114803: defined += FBS = fetal bovine serum
- 10.1016/j.celrep.2024.114803: defined += TLC = Thin layer chromatography
- 10.1016/j.celrep.2024.114803: defined += TFA = trifluoroacetic acid
- 10.1016/j.celrep.2024.114803: defined += FA = formic acid
- 10.1016/j.celrep.2024.114803: defined += HCD = higher-energy collision dissociation
- 10.1016/j.celrep.2024.114803: defined += SCGal = complete synthetic medium containing 2% galactose
- 10.1016/j.celrep.2024.114803: defined += PBS/PIC = PBS supplemented with an EDTA-free protease inhibitor cocktail
- 10.1021/acsnano.6c08211: defined += sc = self-complementary  (figure legend)
- 10.1038/s41467-021-24194-6: defined += IH = intracellular helices  (figure legend key "IH, intracellular helices")
- 10.1038/s41467-021-24194-6: defined += EH = extracellular helices  (figure legend key)
- 10.1186/s12915-026-02678-5: defined += CDS = coding sequence  (figure legend "Abbreviations:" list)
- 10.1186/s12915-026-02678-5: defined += ITR = inverted terminal repeat  (figure legend "Abbreviations:" list)
- 10.64898/2025.12.01.691077: defined += PKD1 = Polycystic Kidney Disease 1
- 10.1126/science.1253920: defined += 3D = three-dimensional
- 10.64898/2025.12.01.691077: defined += VDAC = voltage dependent anion channel  (figure legend key "VDAC = ...")
- 10.64898/2025.12.01.691077: defined += MPC = mitochondrial pyruvate carrier  (figure legend key)
- 10.64898/2025.12.01.691077: defined += AU = arbitrary units  (figure legend key "AU = arbitrary units")
- 10.7554/eLife.83853: defined += AS = antisense  (figure legend key "AS = antisense, S = sense")

### Labelled as undefined, but spelled out in the paper

- 10.1038/s41467-025-66290-x: PDB = Protein Data Bank  ("Protein Data Bank (PDB IDs are listed ...)")
- 10.1038/s41563-025-02418-0: LUV = large unilamellar vesicles  (figure legend key "LUV, large unilamellar vesicles")
- 10.1083/jcb.202310005: uORFs = upstream open reading frames  ("upstream open reading frames, or uORFs")
- 10.1101/2023.12.01.569403: SNP = single nucleotide polymorphisms  ("single" and the rest of the long form are split by a page footer)
- 10.1126/sciadv.abf4459: RNase = ribonuclease  ("bacterial ribonuclease (RNase) P RNA")
- 10.1126/sciadv.abf4459: nt = nucleotide  ("51-nucleotide (nt) RNA tile")
- 10.64898/2025.12.01.691077: TBST = Tris-buffered saline with Tween  ("(TBST: 20 mM Tris, ...)")
- 10.64898/2025.12.01.691077: PBS = phosphate-buffered saline  ("(PBS: 137 mM NaCl, ...)")
- 10.7554/eLife.81856: DMEM = Dulbecco's modified eagle medium  (spelled out in the text)
- 10.7554/eLife.83853: PFA = paraformaldehyde  (spelled out in the text)

- 10.1038/s41565-023-01321-6: nt = nucleotides  ("1,832 nucelotides (nt)"; the misspelling is kept as an alternative)

### Standard abbreviations the papers never spell out

Each used at least twice outside the references.

- 10.1016/j.celrep.2024.114803: PBS
- 10.1016/j.celrep.2024.114803: HEPES
- 10.1016/j.celrep.2024.114803: HPLC
- 10.1016/j.celrep.2024.114803: NMR
- 10.1080/15476286.2023.2237719: mRNA
- 10.1101/2023.12.01.569403: PBS
- 10.1101/2023.12.01.569403: DMSO
- 10.1101/2023.12.01.569403: HPLC
- 10.64898/2025.12.01.691077: siRNA
- 10.7554/eLife.83853: UTR
- 10.7554/eLife.83853: DTT
- 10.1101/2023.12.01.569403: GFP, 10.1101/2023.12.01.569403: PAGE ("HPLC- or PAGE-purified", twice), 10.1016/j.celrep.2024.114803: DNA, 10.7554/eLife.83853: CRISPR, 10.1038/s41563-021-01020-4: RNA  (counting uses inside compounds such as "GFP-tagged" and "DNA/RNA", as the blind pass already did for ATP in "ATP-dependent")

### Moved to ignore

- Only in the reference list: 10.1016/j.celrep.2024.114803: THRONCAT (used in the text, spelled out only in a reference title), 10.1083/jcb.202310005: DMF, 10.1038/s41563-025-02418-0: VLPs, 10.1016/j.celrep.2024.114803: eIF2, 10.1073/pnas.1301676110: LOH, 10.1073/pnas.2207902119: NACA, 10.1038/s41557-021-00679-1: SHAPE-Seq, 10.1371/journal.pgen.1010901: ChIP-seq, 10.1021/acsnano.6c08211: ROSIE (not labelled before), 10.1038/s41598-017-12127-7: DNA, 10.64898/2025.12.01.691077: ATP, 10.64898/2025.12.01.691077: EMT, 10.64898/2025.12.01.691077: lncRNA, 10.64898/2025.12.01.691077: WB, 10.1093/nar/gkae282: DSIF
- Only in acknowledgements, funding, affiliations or licence statements: 10.1101/2023.12.01.569403: ERC, 10.1021/acsnano.6c08211: ERC, 10.1021/acsnano.0c07696: ARC, 10.1021/acsnano.0c07696: CSD3, 10.1021/acsnano.6c08211: BMBF, 10.1038/s41563-025-02418-0: BMFTR, 10.1038/s41563-025-02418-0: RISE, 10.1016/j.celrep.2024.114803: AAM, 10.1371/journal.pgen.1010901: NGI (not labelled before), 10.1021/acsnano.0c07696: EMBL, 10.3389/fimmu.2025.1563049: AI
- Used only once outside the references: 10.1007/978-3-319-11295-4_1: PDB, 10.1021/acsnano.0c07696: EDTA, 10.1021/acsnano.0c07696: PDF, 10.1021/acsnano.6c08211: PCR, 10.1021/acsnano.6c08211: PAGE, 10.1021/acsnano.6c08211: RMSD, 10.1021/acsnano.6c08211: EDTA, 10.1021/acsnano.6c08211: NVT, 10.1021/acsnano.6c08211: NPT, 10.1038/s41467-021-24194-6: ADP, 10.1038/s41467-021-24194-6: EMDB, 10.1038/s41467-022-30235-5: GLUT5, 10.1038/s41467-025-66290-x: UV, 10.1038/s41467-025-66290-x: bp, 10.1038/s41467-025-66290-x: MD, 10.1038/s41467-025-66290-x: SDS, 10.1038/s41467-025-66290-x: HEPES, 10.1038/s41557-021-00679-1: TAE, 10.1038/s41563-025-02418-0: PDB, 10.1038/s41598-026-40706-0: SVM, 10.1038/s41598-026-40706-0: BP, 10.1073/pnas.1017999108: HPLC, 10.1073/pnas.1301676110: TE, 10.1073/pnas.2207902119: CMOS, 10.1080/15476286.2023.2237719: siRNAs, 10.1083/jcb.202310005: ssRNA, 10.1083/jcb.202310005: NAD, 10.1083/jcb.202310005: MAPK, 10.1093/nar/gkae282: ORF, 10.1093/nar/gkae981: tRNA, 10.1093/nar/gkae981: GTP, 10.1093/nar/gkae981: mRNA, 10.1101/2023.12.01.569403: YPD, 10.1371/journal.pgen.1010901: mRNA, 10.1371/journal.pgen.1010901: INDELs, 10.3390/biom14020176: tRNAs, 10.3390/biom14020176: rRNAs, 10.3390/ijms241713527: EGF, 10.3390/ijms241713527: cAMP, 10.3390/ijms241713527: DNA, 10.64898/2025.12.01.691077: DMSO, 10.7554/eLife.83853: RT-PCR, 10.7554/eLife.83853: SDS-PAGE
- A statistic the paper never spells out: 10.1021/acsnano.0c07696: RMSE, 10.1038/s41563-025-02418-0: s.d., 10.1038/s41598-026-40706-0: SD, 10.1073/pnas.1301676110: SD, 10.1073/pnas.2207902119: SDs, 10.1371/journal.pgen.1010901: FDR, 10.64898/2025.12.01.691077: ANOVA, 10.1002/mnfr.201700403: RSD, 10.1101/2023.12.01.569403: SEM (not labelled before)
- A product, database or protein name used as a name: 10.64898/2025.12.01.691077: BSA, 10.64898/2025.12.01.691077: cDNA, 10.7554/eLife.81856: GEO, 10.3390/ijms241713527: TRAIL, 10.1038/s41467-021-24194-6: ABCR, 10.1038/s41467-025-66290-x: LSM 900 (not labelled before)
- Same category as entries already ignored: 10.1371/journal.pgen.1010901: Zm (a factor level, like AAf, AAm and Zf), 10.1126/sciadv.abf4459: 3IGI (a PDB accession code)

### Left standing

One output on dev is still outside the labels: pAG389, a plasmid name, given
its construct description as a meaning. Remaining misses are counted as they
are; the main kinds are long forms whose letters do not follow the short form
(KD, dissociation constant), descriptive definitions (ATF4, "a cytoprotective
transcription factor") and names in other languages (ZMBH).

## Third pass (failure review)

While reviewing the remaining misses, each was read in the text. Changes:

- 10.1093/nar/gkae282: defined += Eco, Bsu, Mtu, Sac, Tko (the figure-legend species key "Eco: Escherichia coli, ..."; Mja from the same key was already labelled)
- 10.7554/eLife.83853: lincRNAs moved from undefined to defined (phrase: "long intergenic noncoding RNAs, or lincRNAs")
- 10.1038/s41467-022-30235-5: CTD = carboxyl terminal domain, as written at the first definition ("C-terminal domain" kept as an alternative)
- 10.64898/2025.12.01.691077: FBS = fetal bovine serum, as written (the label said "foetal")

The scorer now treats a Greek letter and its name as the same word, and ignores accents ("n-dodecyl-β-D-maltoside" = "n-dodecyl-beta-D-maltoside"). This applies to both sets and both detectors.
- 10.1038/s41467-021-24194-6: ABCA alt += "ATP-binding cassette subfamily A" (the text: "ATP-binding cassette (ABC) subfamily A (ABCA)")
- Standard abbreviations the blind pass missed, found when the glossary grew; each used at least twice outside the references (uses inside compounds such as "LC-MS/MS" count) and never spelled out: 10.1016/j.celrep.2024.114803: WT, 10.1016/j.celrep.2024.114803: LC, 10.1016/j.celrep.2024.114803: MS/MS, 10.1038/s41467-021-24194-6: ACN, 10.1038/s41467-021-24194-6: LC, 10.1038/s41467-021-24194-6: MS/MS, 10.1093/nar/gkae282: UV, 10.1093/nar/gkae282: MS/MS, 10.1002/mnfr.201700403: MS/MS, 10.1038/s41598-026-40706-0: IgG, 10.7554/eLife.83853: IgG, 10.7554/eLife.83853: LB, 10.7554/eLife.83853: NCBI, 10.7554/eLife.83853: dsRNA, 10.1038/s41563-021-01020-4: EM, 10.1038/s41563-021-01020-4: TBE, 10.1038/s41565-023-01321-6: EM, 10.3390/biom14020176: NTP
- 10.7554/eLife.81856: FDR to ignore (a statistic the paper never spells out)

The scorer also no longer counts units (bp, nt, kb, ...) as false positives, since the guidelines always ignore them; where a paper's labels list a unit, it is still scored.
